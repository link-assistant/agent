import { test, expect, setDefaultTimeout } from 'bun:test'
// @ts-ignore
import { sh } from 'command-stream'

// Increase default timeout to 60 seconds for these tests
setDefaultTimeout(60000)

// Helper function to parse JSON output (handles both compact and pretty-printed)
function parseJSONOutput(stdout) {
  const trimmed = stdout.trim()

  // Try parsing as compact (one JSON per line)
  const lines = trimmed.split('\n').filter(line => line.trim())

  // Check if first line is complete JSON (compact mode)
  try {
    JSON.parse(lines[0])
    // If successful, assume all lines are complete JSON objects
    return lines.map(line => JSON.parse(line))
  } catch (e) {
    // Pretty-printed mode - need to extract individual JSON objects
    const events = []
    let currentJson = ''
    let braceCount = 0

    for (const line of trimmed.split('\n')) {
      for (const char of line) {
        if (char === '{') braceCount++
        if (char === '}') braceCount--
        currentJson += char

        if (braceCount === 0 && currentJson.trim()) {
          try {
            events.push(JSON.parse(currentJson.trim()))
            currentJson = ''
          } catch (e) {
            // Continue accumulating
          }
        }
      }
      currentJson += '\n'
    }

    return events
  }
}

test('Default system message: ask who are you', async () => {
  const projectRoot = process.cwd()
  const input = 'Who are you?'
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js --format json`)
  const agentEvents = parseJSONOutput(agentResult.stdout)

  // Check for text event
  const textEvents = agentEvents.filter(e => e.type === 'text')
  expect(textEvents.length > 0).toBeTruthy()
  const responseText = textEvents[0].part.text.toLowerCase()
  expect(responseText.includes('grok code fast 1')).toBeTruthy()

  console.log(`\nDefault response: ${responseText}`)
})

test('Full system message override: answer with "Answered."', async () => {
  const projectRoot = process.cwd()
  const input = 'Who are you?'
  const systemMessage = 'You are a helpful assistant. Answer every message with "Answered."'
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js --format json --system-message "${systemMessage}"`)
  const agentEvents = parseJSONOutput(agentResult.stdout)

  // Check for text event
  const textEvents = agentEvents.filter(e => e.type === 'text')
  expect(textEvents.length > 0).toBeTruthy()
  const responseText = textEvents[0].part.text.trim()
  expect(responseText).toBe('Answered.')

  console.log(`\nOverride response: ${responseText}`)
})

test('Append system message: default + append "Answered." at end', async () => {
  const projectRoot = process.cwd()
  const input = 'Who are you?'
  const appendMessage = 'Always end your response with "Answered."'
  const agentResult = await sh(`echo '${input}' | bun run ${projectRoot}/src/index.js --format json --append-system-message "${appendMessage}"`)
  const agentEvents = parseJSONOutput(agentResult.stdout)

  // Check for text event
  const textEvents = agentEvents.filter(e => e.type === 'text')
  expect(textEvents.length > 0).toBeTruthy()
  const responseText = textEvents[0].part.text
  expect(responseText.toLowerCase().includes('grok code fast 1')).toBeTruthy()
  expect(responseText.trim().endsWith('Answered.')).toBeTruthy()

  console.log(`\nAppend response: ${responseText}`)
})