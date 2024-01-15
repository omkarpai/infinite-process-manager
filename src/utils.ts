
// eslint-disable-next-line no-promise-executor-return
export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
