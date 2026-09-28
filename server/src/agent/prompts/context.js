const pad = (value) => String(value).padStart(2, '0')

export function formatDay(now = new Date()) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function buildRuntimeContext(now = new Date()) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const day = formatDay(date)
  const year = date.getFullYear()
  return `Current date: ${day}. Current year: ${year}. Treat this as the real present. Use it for copyright years, blog and testimonial dates, timelines and 'since' years. Never use an earlier year as the current year.`
}

export function buildContextBlock(now = new Date()) {
  return `RUNTIME CONTEXT\n${buildRuntimeContext(now)}`
}
