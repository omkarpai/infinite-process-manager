import { ChildProcess, spawn } from 'child_process';
import { delay } from './utils';

interface StartInfiniteProcessArgs {
  processName: string;
  command: string;
  commandArgs: string[];
}

interface StopInfiniteProcessArgs {
  processName: string;
}

interface InfiniteProcess extends StartInfiniteProcessArgs {
  spawned: boolean;
  childProcess: ChildProcess;
  shouldBeKilled: boolean;
  killed: boolean;
  error: boolean;
}

interface KillChildProcessArgs {
  process: InfiniteProcess;
  resolve: () => void | PromiseLike<void>;
  reject: (reason?: unknown) => void;
}

interface InternalLogger {
  info: (msg: string) => void;
  error: (msg: string) => void;
  warn: (msg: string) => void;
}

class DefaultLogger implements InternalLogger {
  info = (msg: string) => console.log(msg);
  error = (msg: string) => console.log(msg);
  warn = (msg: string) => console.log(msg);
}

interface Options {
  internalLogger?: InternalLogger;
}

const PROCESS_RESPAWN_DELAY_MS = 100;
const SIGINT_MS = 5000;
const SIGKILL_MS = 7000;
const FORCE_REJECT_MS = 10000;

class InfiniteProcessManager {
  // map of process names to InfiniteProcesses
  private readonly PROCESSES: Map<string, InfiniteProcess>;
  private readonly LOGGER: InternalLogger;

  constructor(options?: Options) {
    this.PROCESSES = new Map();
    this.LOGGER = InfiniteProcessManager.resolveLogger(options);
    setInterval(this.logProcesses, 120000);
  }

  private static resolveLogger = (options?: Options): DefaultLogger => {
    if (!options || !options.internalLogger) return new DefaultLogger();
    return options.internalLogger;
  };

  private static toString = (process: InfiniteProcess) => {
    const pid = process.childProcess.pid;
    const { spawned, shouldBeKilled, killed, error } = process;
    return `[${process.processName}] pid:${pid} spawned:${spawned} shouldBeKilled:${shouldBeKilled} killed:${killed} error:${error}\n`;
  };

  private logProcesses = () => {
    let running = `Processes:\n`;
    for (const processName of this.PROCESSES.keys()) {
      const process = this.PROCESSES.get(processName);
      if (!process) continue;
      running = running.concat(InfiniteProcessManager.toString(process));
    }
    this.LOGGER.info(running);
  };

  private setupStdOutHandler = (
    childProcess: ChildProcess,
    processName: string,
  ) => {
    childProcess.stdout?.on('data', (data) => {
      this.LOGGER.info(`[${processName}] stdout: ${data}`);
    });
  };

  private setupStdErrHandler = (
    childProcess: ChildProcess,
    processName: string,
  ) => {
    childProcess.stderr?.on('data', (data) => {
      this.LOGGER.error(`[${processName}] stderr: ${data}`);
    });
  };

  private setupOnExitHandler = (
    childProcess: ChildProcess,
    processName: string,
  ) => {
    childProcess.on('exit', (code, sig) => {
      const process = this.PROCESSES.get(processName);
      if (!process) return;
      this.LOGGER.error(
        `[${processName}] child process ${childProcess.pid} exited with code ${code} SIG ${sig}`,
      );
      process.killed = true;
      if (process.shouldBeKilled) this.cleanupProcess(process);
      if (!process.shouldBeKilled) this.respawnProcess(process);
    });
  };

  private setupOnSpawnHandler = (
    childProcess: ChildProcess,
    processName: string,
  ) => {
    childProcess.on('spawn', () => {
      const process = this.PROCESSES.get(processName);
      if (!process) return;
      const { command, commandArgs } = process;
      this.LOGGER.info(
        `[${processName}] Spawned PID:${childProcess.pid} ${command} ${commandArgs}`,
      );
      process.spawned = true;
      process.killed = false;
    });
  };

  private setupOnErrorHandler = (
    childProcess: ChildProcess,
    processName: string,
  ) => {
    childProcess.on('error', (e) => {
      const process = this.PROCESSES.get(processName);
      if (!process) return;
      this.LOGGER.error(`[${processName}] error on spawn or exit process ${e}`);
      process.error = true;
      if (process.shouldBeKilled) this.cleanupProcess(process);
      if (!process.shouldBeKilled) this.respawnProcess(process);
    });
  };

  private cleanupProcess = async (process: InfiniteProcess) => {
    this.LOGGER.info('DEAD ' + InfiniteProcessManager.toString(process));
    this.PROCESSES.delete(process.processName);
  };

  private respawnProcess = async (process: InfiniteProcess) => {
    await delay(PROCESS_RESPAWN_DELAY_MS);
    this.LOGGER.info('RESPAWNING ' + InfiniteProcessManager.toString(process));
    this.spawnProcess({
      command: process.command,
      commandArgs: process.commandArgs,
      processName: process.processName,
    });
  };

  /**
   * Note: When spawning a ChildProcess, we found that running it with the following
   * args made childProcess.kill('...') not fail. Most processes get killed
   * in the SIGINT fallback if not with SIGTERM.
   * - Using detached:true
   * - Using childProcess.unref()
   *
   * Note2: We are not sure why this works, experimentation and testing is welcome.
   * "If it works, do not touch it" -anonymous
   *
   * Reference:
   * https://nodejs.org/docs/latest-v14.x/api/child_process.html#child_process_child_process_spawn_command_args_options
   * https://nodejs.org/docs/latest-v14.x/api/child_process.html#child_process_subprocess_unref
   * @param args
   */
  private spawnProcess = (args: StartInfiniteProcessArgs) => {
    const { command, commandArgs, processName } = args;
    const childProcess: ChildProcess = spawn(command, commandArgs, {
      detached: true,
    });
    childProcess.unref();
    this.setupOnSpawnHandler(childProcess, processName);
    this.setupOnErrorHandler(childProcess, processName);
    this.setupStdOutHandler(childProcess, processName);
    this.setupStdErrHandler(childProcess, processName);
    this.setupOnExitHandler(childProcess, processName);
    this.PROCESSES.set(processName, {
      childProcess,
      shouldBeKilled: false,
      killed: false,
      spawned: false,
      error: false,
      ...args,
    });
  };

  private killProcess = (process: InfiniteProcess): Promise<void> => {
    return new Promise((resolve, reject) => {
      this.killChildProcess({ process, resolve, reject });
    });
  };

  private killChildProcess = (args: KillChildProcessArgs) => {
    const { process, resolve, reject } = args;
    const { childProcess, processName } = process;
    if (!childProcess.pid) {
      return reject(
        new Error(`[${processName}] child process does not have a PID.`),
      );
    }

    const forceReject = () => {
      this.LOGGER.warn(
        `[${processName}] child process ${childProcess.pid} did not exit on SIGKILL. `,
      );
      this.cleanupProcess(process);
      reject(
        new Error(
          `[${processName}] child process ${childProcess.pid} did not exit after multiple signals.`,
        ),
      );
    };

    const send_SIGINT = () => {
      this.LOGGER.warn(
        `[${processName}] child process ${childProcess.pid} did not exit on SIGTERM. Sending SIGINT.`,
      );
      childProcess.kill('SIGINT');
    };

    const send_SIGKILL = () => {
      this.LOGGER.warn(
        `[${processName}] child process ${childProcess.pid} did not exit on SIGINT. Sending SIGKILL.`,
      );
      childProcess.kill('SIGKILL');
    };

    const SIGINT_timeout = setTimeout(send_SIGINT, SIGINT_MS);
    const SIGKILL_timeout = setTimeout(send_SIGKILL, SIGKILL_MS);
    const forceReject_timeout = setTimeout(forceReject, FORCE_REJECT_MS);

    childProcess.on('exit', (code, sig) => {
      this.LOGGER.error(
        `[${processName}] child process ${childProcess.pid} forced to exit with code ${code} SIG ${sig}`,
      );
      clearTimeout(SIGINT_timeout);
      clearTimeout(SIGKILL_timeout);
      clearTimeout(forceReject_timeout);
      resolve();
    });
    childProcess.kill('SIGTERM');
  };

  private validateNonExistingProcess = (args: StartInfiniteProcessArgs) => {
    if (this.isRunningProcess(args.processName))
      throw new Error(`[${args.processName}] Infinite process already exists`);
  };

  public startInfiniteProcess = (args: StartInfiniteProcessArgs) => {
    this.validateNonExistingProcess(args);
    this.spawnProcess(args);
  };

  public stopWithDelete = async (args: StopInfiniteProcessArgs) => {
    const { processName } = args;
    const infiniteProcess = this.PROCESSES.get(processName);
    if (!infiniteProcess)
      throw new Error(`[${args.processName}] Infinite process not found`);
    infiniteProcess.shouldBeKilled = true;
    await this.killProcess(infiniteProcess);
  };

  public stopWithAutoRespawn = async (args: StopInfiniteProcessArgs) => {
    const { processName } = args;
    const infiniteProcess = this.PROCESSES.get(processName);
    if (!infiniteProcess)
      throw new Error(`[${args.processName}] Infinite process not found`);
    await this.killProcess(infiniteProcess);
  };

  public getRunningProcesses = (): Set<string> => {
    return new Set(this.PROCESSES.keys());
  };

  public isRunningProcess = (processName: string) => {
    return this.PROCESSES.has(processName);
  };
}

export { InfiniteProcessManager };
