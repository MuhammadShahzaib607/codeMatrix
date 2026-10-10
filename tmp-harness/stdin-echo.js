if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdout.write('\u001b[?2004h')
process.stdin.on('data', (chunk) => {
  if (chunk.includes('\u0003')) process.exit(0)
  console.log('IN:' + JSON.stringify(chunk.toString()))
})
