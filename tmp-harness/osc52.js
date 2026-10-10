process.stdout.write('\u001b]52;c;' + Buffer.from('hello').toString('base64') + '\u0007')
setTimeout(() => {}, 400)
