const segments = Array.from({ length: 14 }, (_, index) => `guide-chapter-${index}-details`)
const url = `https://example.com/documentation/${segments.join('/')}/installation-and-usage-faq`
console.log(url)
console.log('URL_PRINTED length=' + url.length)
setTimeout(() => {}, 300)
