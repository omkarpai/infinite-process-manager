# Infinite Process Manager

### Basic Usage

```javascript
const { InfiniteProcessManager } = require('infinite-process-manager');

const ipmInstance = new InfiniteProcessManager();
export { ipmInstance };
```

InfiniteProcessManager also accepts options for logging INFO,ERROR and WARN messages.

### With custom logger

```javascript
const ipm = new InfiniteProcessManager({
  internalLogger: {
    info: (msg) => console.log(msg),
    error: (msg) => console.log(msg),
    warn: (msg) => console.log(msg),
  },
});
```

The exported instance can then be used to start - stop processes as required.

### Starting processes

```javascript
import { ipmInstance } from '.';

ipmInstance.startInfiniteProcess({
  command: 'ls',
  processName: 'pName',
  commandArgs: ['-lah'],
});
```

### Stopping processes

- To avoid respawn

```javascript
ipm.stopWithDelete({ processName: 'pName' });
```

- With respawn

```javascript
ipm.stopWithAutoRespawn({ processName: 'pName' });
```
