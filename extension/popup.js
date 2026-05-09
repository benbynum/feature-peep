let state = { flags: {}, overrides: {}, provider: null, transport: null }
let expandedKey = null
let pendingPollRefresh = false
let searchQuery = ''
let searchOpen = false
let searchStateKey  = 'fc:searchOpen'
let searchQueryKey  = 'fc:searchQuery'

const PROVIDERS = {
  launchdarkly: {
    name: 'LaunchDarkly',
    svgPath: 'M1571 3174 c-12 -15 -21 -35 -21 -44 0 -18 97 -156 523 -745 124 -170 223 -311 222 -313 -2 -2 -293 116 -648 262 -355 146 -657 266 -671 266 -56 0 -88 -78 -48 -118 9 -9 270 -167 580 -351 309 -184 561 -335 559 -337 -2 -2 -199 -15 -438 -29 -238 -14 -544 -32 -679 -40 -135 -8 -380 -21 -545 -30 -353 -19 -360 -20 -386 -46 -24 -24 -25 -73 0 -98 23 -23 40 -25 426 -46 154 -9 390 -22 525 -30 135 -8 328 -19 430 -25 382 -22 663 -40 666 -42 1 -2 -253 -155 -565 -341 -312 -185 -572 -342 -579 -349 -20 -20 -14 -72 11 -96 40 -38 -47 -69 817 288 283 117 523 216 533 221 9 6 17 8 17 5 0 -2 -165 -233 -367 -513 -202 -279 -371 -520 -377 -535 -15 -39 18 -82 66 -86 34 -3 52 14 801 769 548 553 768 780 772 801 16 70 30 55 -773 860 -701 704 -768 768 -798 768 -23 0 -38 -8 -53 -26z',
    svgTransform: 'translate(0,320) scale(0.1,-0.1)',
    viewBox: '0 0 320 320',
  }
}

const TRANSPORT_ICONS = {
  polling: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transport-icon"><path d="M5 2h14v4l-7 6 7 6v4H5v-4l7-6-7-6V2z"/></svg>`,
  sse:     `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transport-icon"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>`,
}

function providerBadgeHTML(provider, transport) {
  const p = PROVIDERS[provider]
  const transportLabel = transport === 'sse' ? 'streaming' : transport === 'polling' ? 'polling' : 'detected'
  const transportIcon = TRANSPORT_ICONS[transport] || ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.viewBox}" class="provider-logo" aria-hidden="true"><g transform="${p.svgTransform}" fill="currentColor" stroke="none"><path d="${p.svgPath}"/></g></svg><span class="provider-name">${p.name}</span><span class="provider-detected">${transportLabel} ${transportIcon}</span>`
}

// ── Helpers ───────────────────────────────────────────────────────────────

function inferType(value) {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number')  return 'number'
  if (typeof value === 'string')  return 'string'
  return 'json'
}

function formatValue(value, type) {
  if (type === 'boolean') return String(value)
  if (type === 'string')  return `"${value}"`
  if (type === 'json')    return JSON.stringify(value)
  return String(value)
}

function valueClass(value, type) {
  if (type === 'boolean') return value ? 'bool-true' : 'bool-false'
  return type
}

function send(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => {})
}

// Sends an override mutation and marks a refresh needed for polling transport.
function sendOverride(msg) {
  send(msg)
  if (state.transport === 'polling') pendingPollRefresh = true
}

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  const { flags, overrides } = state
  const keys = Object.keys(flags)
  const overrideCount = Object.keys(overrides).length
  const filteredKeys = searchQuery
    ? keys.filter(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
    : keys

  const emptyEl        = document.getElementById('state-empty')
  const flagsEl        = document.getElementById('state-flags')
  const badgeEl        = document.getElementById('provider-badge')
  const toolbarEl      = document.getElementById('toolbar')
  const countEl        = document.getElementById('override-count')
  const clearBtn       = document.getElementById('clear-all-btn')
  const pollRefreshBar = document.getElementById('poll-refresh-bar')
  const listEl         = document.getElementById('flag-list')

  if (keys.length === 0) {
    document.body.style.height = ''
    emptyEl.classList.remove('hidden')
    flagsEl.classList.add('hidden')
    badgeEl.classList.add('hidden')
    toolbarEl.classList.add('hidden')
    searchToggle.classList.add('hidden')
    return
  }

  searchToggle.classList.remove('hidden')
  searchToggle.classList.toggle('active', searchOpen)

  document.body.style.height = '560px'
  emptyEl.classList.add('hidden')
  flagsEl.classList.remove('hidden')
  const provider = state.provider || 'launchdarkly'
  badgeEl.innerHTML = providerBadgeHTML(provider, state.transport)
  badgeEl.classList.remove('hidden')

  if (overrideCount > 0) {
    countEl.textContent = `${overrideCount} override${overrideCount > 1 ? 's' : ''} active`
    toolbarEl.classList.remove('hidden')
  } else {
    toolbarEl.classList.add('hidden')
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
    li.dataset.key = key

    // ── Flag row ────────────────────────────────────────────────────────
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

    // ── Editor ──────────────────────────────────────────────────────────
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
          if (flag.value === true) {
            sendOverride({ type: 'CLEAR_OVERRIDE', key })
            delete state.overrides[key]
          } else {
            sendOverride({ type: 'SET_OVERRIDE', key, value: true })
            state.overrides[key] = true
          }
          render()
        })

        const falseBtn = document.createElement('button')
        falseBtn.className = `bool-option${current === false ? ' active-false' : ''}`
        falseBtn.textContent = 'false'
        falseBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (flag.value === false) {
            sendOverride({ type: 'CLEAR_OVERRIDE', key })
            delete state.overrides[key]
          } else {
            sendOverride({ type: 'SET_OVERRIDE', key, value: false })
            state.overrides[key] = false
          }
          render()
        })

        toggleRow.appendChild(trueBtn)
        toggleRow.appendChild(falseBtn)

        if (hasOverride) {
          const restore = document.createElement('button')
          restore.className = 'editor-restore'
          restore.textContent = 'restore'
          restore.addEventListener('click', (e) => {
            e.stopPropagation()
            sendOverride({ type: 'CLEAR_OVERRIDE', key })
            delete state.overrides[key]
            render()
          })
          toggleRow.appendChild(restore)
        }

        editor.appendChild(toggleRow)

      } else {
        // String / number / JSON editor
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
          let parsed
          try {
            parsed = type === 'string' ? input.value : JSON.parse(input.value)
          } catch (_) {
            input.style.borderColor = '#dc2626'
            return
          }
          if (JSON.stringify(parsed) === JSON.stringify(flag.value)) {
            sendOverride({ type: 'CLEAR_OVERRIDE', key })
            delete state.overrides[key]
          } else {
            sendOverride({ type: 'SET_OVERRIDE', key, value: parsed })
            state.overrides[key] = parsed
          }
          render()
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
            sendOverride({ type: 'CLEAR_OVERRIDE', key })
            delete state.overrides[key]
            render()
          })
          editor.appendChild(restore)
        }

        // Focus input after render
        requestAnimationFrame(() => input.focus())
      }

      li.appendChild(editor)
    }

    listEl.appendChild(li)
  }
}

// ── Init ──────────────────────────────────────────────────────────────────

// Resolves the active tab in the last-focused normal browser window.
// Calling this fresh each time avoids stale background-side tracking state.
function getActiveTab(callback) {
  chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (win) => {
    if (chrome.runtime.lastError || !win) return callback(null)
    chrome.tabs.query({ active: true, windowId: win.id }, (tabs) => {
      callback(tabs[0] || null, win.id)
    })
  })
}

function reloadActiveTab(btn) {
  btn.classList.add('spinning')
  btn.addEventListener('animationend', () => btn.classList.remove('spinning'), { once: true })
  getActiveTab((tab) => {
    if (tab) chrome.tabs.reload(tab.id)
  })
}

const searchToggle = document.getElementById('search-toggle')
const searchBar    = document.getElementById('search-bar')
const searchInput  = document.getElementById('search-input')
const searchClear  = document.getElementById('search-clear')

function applySearchOpen() {
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
    localStorage.removeItem(searchQueryKey)
  }
  localStorage.setItem(searchStateKey, searchOpen)
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
  localStorage.setItem(searchQueryKey, searchQuery)
  render()
})

searchClear.addEventListener('click', () => {
  searchQuery = ''
  searchInput.value = ''
  searchClear.classList.add('hidden')
  localStorage.removeItem(searchQueryKey)
  searchInput.focus()
  render()
})

const retryBtn = document.getElementById('retry-btn')
retryBtn.addEventListener('click', () => reloadActiveTab(retryBtn))

document.getElementById('clear-all-btn').addEventListener('click', () => {
  sendOverride({ type: 'CLEAR_ALL_OVERRIDES' })
  state.overrides = {}
  expandedKey = null
  render()
})

const pollRefreshBtn = document.getElementById('poll-refresh-btn')
pollRefreshBtn.addEventListener('click', () => reloadActiveTab(pollRefreshBtn))

// Request current state — resolve the tab ourselves so background doesn't need
// to track it, avoiding stale state from service worker restarts or async lag.
getActiveTab((tab, windowId) => {
  if (tab?.url) {
    try {
      const origin = new URL(tab.url).origin
      searchStateKey = `fc:searchOpen:${origin}`
      searchQueryKey = `fc:searchQuery:${origin}`
    } catch (_) {}
  }
  searchOpen  = localStorage.getItem(searchStateKey) === 'true'
  searchQuery = localStorage.getItem(searchQueryKey) || ''

  chrome.runtime.sendMessage({ type: 'GET_FLAGS', tabId: tab?.id || null, windowId: windowId || null }, (response) => {
    if (response) {
      state = { flags: {}, overrides: {}, provider: null, transport: null, ...response }
      render()
      applySearchOpen()
      if (searchOpen) searchInput.focus()
    }
  })
})

// Listen for live updates while popup is open
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'FLAGS_UPDATE') {
    state.flags = msg.flags
    state.overrides = msg.overrides
    state.provider = msg.provider || state.provider
    state.transport = msg.transport || state.transport
    render()
    applySearchOpen()
  }
})
