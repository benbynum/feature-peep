import { meta as ldMeta } from './providers/launchdarkly.js'
import { meta as ofMeta } from './providers/openfeature.js'
import { meta as phMeta } from './providers/posthog.js'
import { DEMO_SITE_URL } from './demoFlags.js'
import {
  MSG_SET_OVERRIDE, MSG_CLEAR_OVERRIDE, MSG_CLEAR_ALL_OVERRIDES,
  MSG_FLAGS_UPDATE, MSG_GET_FLAGS, STORAGE_THEME, STORAGE_LAST_FEEDBACK, FORMSPREE_ENDPOINT,
} from '../constants.js'
import type { FlagsMap, Overrides, ProviderMeta } from '../types.js'

interface AppState {
  flags: FlagsMap
  overrides: Overrides
  provider: string | null
  transport: string | null
}

let state: AppState = { flags: {}, overrides: {}, provider: null, transport: null }
let expandedKey: string | null = null
let pendingPollRefresh = false
let searchQuery = ''
let searchOpen = false
let searchStateKey = 'fc:searchOpen'
let searchQueryKey = 'fc:searchQuery'

const PROVIDERS: Record<string, ProviderMeta> = {
  [ldMeta.id]: ldMeta,
  [ofMeta.id]: ofMeta,
  [phMeta.id]: phMeta,
}

const TRANSPORT_ICONS: Record<string, string> = {
  polling: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transport-icon"><path d="M5 2h14v4l-7 6 7 6v4H5v-4l7-6-7-6V2z"/></svg>`,
  sse:     `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transport-icon"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>`,
}

function providerBadgeHTML(provider: string, transport: string | null): string {
  const p = PROVIDERS[provider]
  const logoHTML = p.imageSrc
    ? `<img src="${p.imageSrc}" class="provider-logo" aria-hidden="true" />`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.viewBox}" class="provider-logo" aria-hidden="true"><g transform="${p.svgTransform}" fill="currentColor" stroke="none"><path d="${p.svgPath}"/></g></svg>`
  const transportLabel = transport === 'sse' ? 'streaming' : transport === 'polling' ? 'polling' : 'detected'
  const transportIcon = transport ? (TRANSPORT_ICONS[transport] ?? '') : ''
  if (p.logoOnly) return `${logoHTML}<span class="provider-detected">${transportLabel} ${transportIcon}</span>`
  return `${logoHTML}<span class="provider-name">${p.name}</span><span class="provider-detected">${transportLabel} ${transportIcon}</span>`
}

// ── Helpers ───────────────────────────────────────────────────────────────

function inferType(value: unknown): 'boolean' | 'number' | 'string' | 'json' {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number')  return 'number'
  if (typeof value === 'string')  return 'string'
  return 'json'
}

function formatValue(value: unknown, type: string): string {
  if (type === 'boolean') return String(value)
  if (type === 'string')  return `"${value as string}"`
  if (type === 'json')    return JSON.stringify(value)
  return String(value)
}

function valueClass(value: unknown, type: string): string {
  if (type === 'boolean') return value ? 'bool-true' : 'bool-false'
  return type
}

function send(msg: object): void {
  chrome.runtime.sendMessage(msg).catch(() => {})
}

function sendOverride(msg: object): void {
  send(msg)
  if (state.transport === 'polling') pendingPollRefresh = true
}

function applyOverride(key: string, value: unknown): void {
  sendOverride({ type: MSG_SET_OVERRIDE, key, value })
  state.overrides[key] = value
  render()
}

function clearOverride(key: string): void {
  sendOverride({ type: MSG_CLEAR_OVERRIDE, key })
  delete state.overrides[key]
  render()
}

// ── Render ────────────────────────────────────────────────────────────────

function render(): void {
  const flags     = state.flags
  const overrides = state.overrides

  const keys = Object.keys(flags)
  const overrideCount = Object.keys(overrides).length
  const filteredKeys = searchQuery
    ? keys.filter(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
    : keys

  const emptyEl        = document.getElementById('state-empty')!
  const flagsEl        = document.getElementById('state-flags')!
  const badgeEl        = document.getElementById('provider-badge')!
  const overrideInfoEl = document.getElementById('override-info')!
  const countEl        = document.getElementById('override-count')!
  const pollRefreshBar = document.getElementById('poll-refresh-bar')!
  const listEl         = document.getElementById('flag-list')!

  if (keys.length === 0) {
    document.body.style.height = ''
    emptyEl.classList.remove('hidden')
    flagsEl.classList.add('hidden')
    badgeEl.classList.add('hidden')
    overrideInfoEl.classList.add('hidden')
    searchToggle.classList.add('hidden')
    return
  }

  searchToggle.classList.remove('hidden')
  searchToggle.classList.toggle('active', searchOpen)

  document.body.style.height = '560px'
  emptyEl.classList.add('hidden')
  flagsEl.classList.remove('hidden')

  const provider = state.provider || 'launchdarkly'
  const providerMeta = PROVIDERS[provider]
  badgeEl.classList.toggle('badge--light', !!providerMeta?.lightBadge)
  badgeEl.innerHTML = providerBadgeHTML(provider, state.transport)
  const transportLabel = state.transport === 'sse' ? 'streaming' : state.transport === 'polling' ? 'polling' : null
  badgeEl.title = transportLabel
    ? `Auto-detected: ${providerMeta?.name || provider} via ${transportLabel}`
    : `Auto-detected: ${providerMeta?.name || provider}`
  badgeEl.classList.remove('hidden')

  overrideInfoEl.classList.toggle('hidden', overrideCount === 0)
  if (overrideCount > 0) {
    countEl.textContent = `${overrideCount} override${overrideCount > 1 ? 's' : ''} active`
  }

  if (pendingPollRefresh && state.transport === 'polling') {
    pollRefreshBar.classList.remove('hidden')
  } else {
    pollRefreshBar.classList.add('hidden')
  }

  listEl.innerHTML = ''

  for (const key of filteredKeys.sort()) {
    const flag = flags[key]
    const hasOverride = key in overrides && JSON.stringify(overrides[key]) !== JSON.stringify(flag.value)
    const displayValue = hasOverride ? overrides[key] : flag.value
    const type = inferType(flag.value)
    const isExpanded = expandedKey === key

    const li = document.createElement('li')
    li.className = `flag-item${hasOverride ? ' overridden' : ''}`
    li.dataset['key'] = key

    const row = document.createElement('div')
    row.className = 'flag-row'
    row.title = hasOverride
      ? `Overriding: ${formatValue(flag.value, type)}`
      : 'Click to override'

    const keyEl = document.createElement('span')
    keyEl.className = 'flag-key'
    keyEl.textContent = key

    const typeEl = document.createElement('span')
    typeEl.className = 'flag-type'
    typeEl.textContent = type

    const valueEl = document.createElement('span')
    valueEl.className = `flag-value ${valueClass(displayValue, type)}`
    valueEl.textContent = formatValue(displayValue, type)

    row.appendChild(keyEl)
    row.appendChild(typeEl)
    row.appendChild(valueEl)

    if (hasOverride) {
      const badge = document.createElement('span')
      badge.className = 'override-badge'
      badge.textContent = '⚡'
      row.appendChild(badge)
    }

    row.addEventListener('click', () => {
      expandedKey = isExpanded ? null : key
      render()
    })

    li.appendChild(row)

    if (isExpanded) {
      const editor = document.createElement('div')
      editor.className = 'flag-editor'

      const label = document.createElement('div')
      label.className = 'editor-label'
      label.textContent = hasOverride ? 'Override active' : 'Override inactive'
      if (!hasOverride) label.style.opacity = '0.5'
      editor.appendChild(label)

      if (type === 'boolean') {
        const toggleRow = document.createElement('div')
        toggleRow.className = 'bool-toggle-row'

        const current = hasOverride ? overrides[key] : flag.value

        const trueBtn = document.createElement('button')
        trueBtn.className = `bool-option${current === true ? ' active-true' : ''}`
        trueBtn.textContent = 'true'
        trueBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (flag.value === true) { clearOverride(key) } else { applyOverride(key, true) }
        })

        const falseBtn = document.createElement('button')
        falseBtn.className = `bool-option${current === false ? ' active-false' : ''}`
        falseBtn.textContent = 'false'
        falseBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (flag.value === false) { clearOverride(key) } else { applyOverride(key, false) }
        })

        toggleRow.appendChild(trueBtn)
        toggleRow.appendChild(falseBtn)

        if (hasOverride) {
          const restore = document.createElement('button')
          restore.className = 'editor-restore'
          restore.textContent = 'restore'
          restore.addEventListener('click', (e) => {
            e.stopPropagation()
            clearOverride(key)
          })
          toggleRow.appendChild(restore)
        }

        editor.appendChild(toggleRow)

      } else {
        const editorRow = document.createElement('div')
        editorRow.className = 'editor-row'

        const input = document.createElement('input')
        input.className = 'editor-input'
        input.type = 'text'
        input.value = hasOverride
          ? (type === 'string' ? String(overrides[key]) : JSON.stringify(overrides[key]))
          : (type === 'string' ? String(flag.value) : JSON.stringify(flag.value))
        input.placeholder = type === 'string' ? 'string value' : 'JSON value'

        const apply = () => {
          let parsed: unknown
          try {
            parsed = type === 'string' ? input.value : JSON.parse(input.value)
          } catch (_) {
            input.style.borderColor = getComputedStyle(document.body).getPropertyValue('--val-bool-false').trim()
            return
          }
          if (JSON.stringify(parsed) === JSON.stringify(flag.value)) {
            clearOverride(key)
          } else {
            applyOverride(key, parsed)
          }
        }

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); apply() }
          if (e.key === 'Escape') { expandedKey = null; render() }
        })
        input.addEventListener('click', (e) => e.stopPropagation())

        const applyBtn = document.createElement('button')
        applyBtn.className = 'editor-apply'
        applyBtn.textContent = 'Apply'
        applyBtn.addEventListener('click', (e) => { e.stopPropagation(); apply() })

        editorRow.appendChild(input)
        editorRow.appendChild(applyBtn)
        editor.appendChild(editorRow)

        if (hasOverride) {
          const restore = document.createElement('button')
          restore.className = 'editor-restore'
          restore.textContent = 'restore'
          restore.addEventListener('click', (e) => {
            e.stopPropagation()
            clearOverride(key)
          })
          editor.appendChild(restore)
        }

        requestAnimationFrame(() => input.focus())
      }

      li.appendChild(editor)
    }

    listEl.appendChild(li)
  }
}

// ── Init ──────────────────────────────────────────────────────────────────

function getActiveTab(callback: (tab: chrome.tabs.Tab | null, windowId?: number) => void): void {
  chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (win) => {
    if (chrome.runtime.lastError || !win) return callback(null)
    chrome.tabs.query({ active: true, windowId: win.id }, (tabs) => {
      callback(tabs[0] || null, win.id)
    })
  })
}

function reloadActiveTab(btn: HTMLElement): void {
  btn.classList.add('spinning')
  btn.addEventListener('animationend', () => btn.classList.remove('spinning'), { once: true })
  getActiveTab((tab) => {
    if (tab?.id != null) chrome.tabs.reload(tab.id)
  })
}

const searchToggle = document.getElementById('search-toggle')!
const searchBar    = document.getElementById('search-bar')!
const searchInput  = document.getElementById('search-input') as HTMLInputElement
const searchClear  = document.getElementById('search-clear')!

function applySearchOpen(): void {
  searchToggle.classList.toggle('active', searchOpen)
  if (searchOpen) {
    searchBar.classList.remove('hidden')
    searchInput.value = searchQuery
    searchClear.classList.toggle('hidden', !searchQuery)
  } else {
    searchBar.classList.add('hidden')
    searchQuery = ''
    searchInput.value = ''
    searchClear.classList.add('hidden')
    chrome.storage.local.remove(searchQueryKey)
  }
  chrome.storage.local.set({ [searchStateKey]: searchOpen })
}

searchToggle.addEventListener('click', () => {
  searchOpen = !searchOpen
  applySearchOpen()
  if (searchOpen) searchInput.focus()
  else render()
})

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value
  searchClear.classList.toggle('hidden', !searchQuery)
  chrome.storage.local.set({ [searchQueryKey]: searchQuery })
  render()
})

searchClear.addEventListener('click', () => {
  searchQuery = ''
  searchInput.value = ''
  searchClear.classList.add('hidden')
  chrome.storage.local.remove(searchQueryKey)
  searchInput.focus()
  render()
})

const retryBtn = document.getElementById('retry-btn')!
retryBtn.addEventListener('click', () => reloadActiveTab(retryBtn))

document.getElementById('clear-all-btn')!.addEventListener('click', () => {
  sendOverride({ type: MSG_CLEAR_ALL_OVERRIDES })
  state.overrides = {}
  expandedKey = null
  render()
})

// ── Settings ──────────────────────────────────────────────────────────────

document.getElementById('settings-version')!.textContent =
  chrome.runtime.getManifest().version

function updateSettingsButtons(): void {
  const isDark = document.body.classList.contains('dark')
  document.getElementById('theme-light-btn')!.classList.toggle('active', !isDark)
  document.getElementById('theme-dark-btn')!.classList.toggle('active', isDark)
}

function setTheme(theme: 'light' | 'dark'): void {
  document.body.classList.toggle('dark', theme === 'dark')
  chrome.storage.local.set({ [STORAGE_THEME]: theme })
  updateSettingsButtons()
}

function openSettings(): void {
  document.body.classList.add('settings-open')
  document.body.style.height = '560px'
  updateSettingsButtons()
}

function closeSettings(): void {
  document.body.classList.remove('settings-open')
  render()
}

document.getElementById('settings-btn')!.addEventListener('click', openSettings)

function handleSettingsBack(): void {
  if (!document.getElementById('feedback-view')!.classList.contains('hidden')) {
    closeFeedbackView()
  } else {
    closeSettings()
  }
}

for (const id of ['settings-back-btn', 'settings-back-btn-footer']) {
  document.getElementById(id)!.addEventListener('click', handleSettingsBack)
}

document.getElementById('theme-light-btn')!.addEventListener('click', () => setTheme('light'))
document.getElementById('theme-dark-btn')!.addEventListener('click', () => setTheme('dark'))

document.getElementById('view-demo-btn')!.addEventListener('click', () => {
  chrome.tabs.create({ url: DEMO_SITE_URL })
})

document.getElementById('privacy-link-btn')!.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://featurepeep.com/privacy' })
})

// ── Feedback ──────────────────────────────────────────────────

const FEEDBACK_COOLDOWN_MS = 24 * 60 * 60 * 1000
const GITHUB_ISSUES_URL = 'https://github.com/benbynum/feature-peep/issues'
let feedbackChallenge = { a: 0, b: 0 }

function genChallenge(): void {
  feedbackChallenge.a = Math.floor(Math.random() * 9) + 1
  feedbackChallenge.b = Math.floor(Math.random() * 9) + 1
  document.getElementById('feedback-challenge-label')!.textContent =
    `What is ${feedbackChallenge.a} + ${feedbackChallenge.b}?`
  ;(document.getElementById('feedback-captcha-input') as HTMLInputElement).value = ''
}

function openFeedbackView(): void {
  document.getElementById('settings-main-content')!.classList.add('hidden')
  document.getElementById('feedback-view')!.classList.remove('hidden')
  document.getElementById('feedback-ratelimit')!.classList.add('hidden')
  document.getElementById('feedback-challenge')!.classList.remove('hidden')
  document.getElementById('feedback-compose')!.classList.add('hidden')
  document.getElementById('feedback-success')!.classList.add('hidden')
  document.getElementById('feedback-challenge-error')!.classList.add('hidden')
  document.getElementById('feedback-submit-error')!.classList.add('hidden')
  ;(document.getElementById('feedback-textarea') as HTMLTextAreaElement).value = ''
  document.getElementById('feedback-char-count')!.textContent = '0 / 200'

  chrome.storage.local.get([STORAGE_LAST_FEEDBACK], (result) => {
    const last = result[STORAGE_LAST_FEEDBACK] as number | undefined
    const limited = last != null && Date.now() - last < FEEDBACK_COOLDOWN_MS
    document.getElementById('feedback-ratelimit')!.classList.toggle('hidden', !limited)
    document.getElementById('feedback-challenge')!.classList.toggle('hidden', limited)
    if (!limited) {
      genChallenge()
      ;(document.getElementById('feedback-captcha-input') as HTMLInputElement).focus()
    }
  })
}

function closeFeedbackView(): void {
  document.getElementById('feedback-view')!.classList.add('hidden')
  document.getElementById('settings-main-content')!.classList.remove('hidden')
}

document.getElementById('feedback-btn')!.addEventListener('click', openFeedbackView)

function verifyChallenge(): void {
  const input = document.getElementById('feedback-captcha-input') as HTMLInputElement
  const val = parseInt(input.value, 10)
  if (val === feedbackChallenge.a + feedbackChallenge.b) {
    document.getElementById('feedback-challenge')!.classList.add('hidden')
    document.getElementById('feedback-compose')!.classList.remove('hidden')
    ;(document.getElementById('feedback-textarea') as HTMLTextAreaElement).focus()
  } else {
    document.getElementById('feedback-challenge-error')!.classList.remove('hidden')
    genChallenge()
  }
}

document.getElementById('feedback-verify-btn')!.addEventListener('click', verifyChallenge)
document.getElementById('feedback-cancel-btn')!.addEventListener('click', closeFeedbackView)

document.getElementById('feedback-captcha-input')!.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') verifyChallenge()
})

const feedbackTextarea = document.getElementById('feedback-textarea') as HTMLTextAreaElement
const feedbackCharCount = document.getElementById('feedback-char-count')!

feedbackTextarea.addEventListener('input', () => {
  const len = feedbackTextarea.value.length
  feedbackCharCount.textContent = `${len} / 200`
  feedbackCharCount.classList.toggle('over-limit', len > 180)
})

document.getElementById('feedback-submit-btn')!.addEventListener('click', async () => {
  const msg = feedbackTextarea.value.trim()
  if (!msg) return
  const btn = document.getElementById('feedback-submit-btn') as HTMLButtonElement
  btn.disabled = true
  btn.textContent = 'Sending…'
  const errEl = document.getElementById('feedback-submit-error')!
  const errorMessages: Record<number, string> = {
    402: `Monthly feedback quota from all users has been hit. Try again next month or submit feedback on <a href="${GITHUB_ISSUES_URL}" target="_blank">GitHub</a>.`,
    422: 'Your message was flagged as spam. If this is an error, please reach out directly.',
    429: 'Too many requests — please try again in a few minutes.',
  }
  try {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, _subject: '[FeaturePeep Feedback]' }),
    })
    if (!res.ok) {
      errEl.innerHTML = errorMessages[res.status] ?? 'Something went wrong — please try again.'
      errEl.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = 'Send'
      return
    }
    chrome.storage.local.set({ [STORAGE_LAST_FEEDBACK]: Date.now() })
    document.getElementById('feedback-compose')!.classList.add('hidden')
    document.getElementById('feedback-success')!.classList.remove('hidden')
  } catch {
    errEl.innerHTML = 'Something went wrong — please try again.'
    errEl.classList.remove('hidden')
    btn.disabled = false
    btn.textContent = 'Send'
  }
})

const pollRefreshBtn = document.getElementById('poll-refresh-btn')!
pollRefreshBtn.addEventListener('click', () => reloadActiveTab(pollRefreshBtn))

getActiveTab((tab, windowId) => {
  if (tab?.url) {
    try {
      const origin = new URL(tab.url).origin
      searchStateKey = `fc:searchOpen:${origin}`
      searchQueryKey = `fc:searchQuery:${origin}`
    } catch (_) {}
  }
  let flagsResponse: AppState | undefined
  let storageReady = false
  let flagsReady   = false

  function maybeRender(): void {
    if (!storageReady || !flagsReady) return
    if (flagsResponse) {
      state = {
        flags:     flagsResponse.flags     ?? {},
        overrides: flagsResponse.overrides ?? {},
        provider:  flagsResponse.provider  ?? null,
        transport: flagsResponse.transport ?? null,
      }
    }
    render()
    applySearchOpen()
    if (searchOpen) searchInput.focus()
  }

  chrome.storage.local.get([searchStateKey, searchQueryKey, STORAGE_THEME], (result) => {
    searchOpen  = result[searchStateKey] === true
    searchQuery = (result[searchQueryKey] as string) || ''
    if (result[STORAGE_THEME] === 'dark') document.body.classList.add('dark')
    storageReady = true
    maybeRender()
  })

  chrome.runtime.sendMessage({ type: MSG_GET_FLAGS, tabId: tab?.id ?? null, windowId: windowId ?? null }, (response: AppState | undefined) => {
    flagsResponse = response
    flagsReady = true
    maybeRender()
  })
})

chrome.runtime.onMessage.addListener((msg: { type: string; flags?: FlagsMap; overrides?: Overrides; provider?: string; transport?: string }) => {
  if (msg.type === MSG_FLAGS_UPDATE) {
    state.flags = msg.flags ?? {}
    state.overrides = msg.overrides ?? {}
    state.provider = msg.provider ?? state.provider
    state.transport = msg.transport ?? state.transport
    render()
    applySearchOpen()
  }
})
