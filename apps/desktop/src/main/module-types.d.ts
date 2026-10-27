/**
 * Ambient declaration for electron-vite's `?modulePath` worker import.
 *
 *   import calcWorker from './calculator.worker?modulePath'
 *
 * electron-vite compiles the worker and rewrites this to a module that defaults
 * to the worker's resolved filesystem path (a string), used as `new Worker(path)`.
 * The node project gets this shape from `electron-vite/node`, but the web project
 * (which also type-checks `src/main`) does not, so we declare it explicitly.
 */
declare module '*?modulePath' {
  const modulePath: string
  export default modulePath
}
