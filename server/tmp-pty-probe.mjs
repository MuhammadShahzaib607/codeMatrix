const ptyModule = await import('node-pty')
const pty = ptyModule.default ?? ptyModule
const cwd = 'C:\\Projects\\CodeMatrix\\server\\workspaces\\scratch-guest'
const started = Date.now()

let proc
try {
  proc = pty.spawn('C:\\Program Files\\Git\\bin\\bash.exe', ['-c', 'echo hi && node --version'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    useConpty: false,
  })
} catch (error) {
  console.log('SPAWN THREW:', error.message)
  process.exit(1)
}
console.log('spawned pid', proc.pid)
proc.onData((data) => console.log('DATA:', JSON.stringify(data)))
proc.onExit((exit) => {
  console.log('EXIT:', JSON.stringify(exit), Date.now() - started, 'ms')
  process.exit(0)
})
setTimeout(() => {
  console.log('NO EXIT AFTER 4000ms')
  process.exit(2)
}, 4000)
