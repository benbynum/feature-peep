let state = { flags: {}, overrides: {} }
let expandedKey = null

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

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  const { flags, overrides } = state
  const keys = Object.keys(flags)
  const overrideCount = Object.keys(overrides).length

  const emptyEl   = document.getElementById('state-empty')
  const flagsEl   = document.getElementById('state-flags')
  const badgeEl   = document.getElementById('provider-badge')
  const countEl   = document.getElementById('override-count')
  const clearBtn  = document.getElementById('clear-all-btn')
  const listEl    = document.getElementById('flag-list')

  if (keys.length === 0) {
    emptyEl.classList.remove('hidden')
    flagsEl.classList.add('hidden')
    badgeEl.classList.add('hidden')
    return
  }

  emptyEl.classList.add('hidden')
  flagsEl.classList.remove('hidden')
  badgeEl.classList.remove('hidden')

  if (overrideCount > 0) {
    countEl.textContent = `${overrideCount} override${overrideCount > 1 ? 's' : ''} active`
    countEl.classList.remove('hidden')
    clearBtn.classList.remove('hidden')
  } else {
    countEl.classList.add('hidden')
    clearBtn.classList.add('hidden')
  }

  listEl.innerHTML = ''

  for (const key of keys.sort()) {
    const flag = flags[key]
    const hasOverride = key in overrides
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
          send({ type: 'SET_OVERRIDE', key, value: true })
          state.overrides[key] = true
          render()
        })

        const falseBtn = document.createElement('button')
        falseBtn.className = `bool-option${current === false ? ' active-false' : ''}`
        falseBtn.textContent = 'false'
        falseBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          send({ type: 'SET_OVERRIDE', key, value: false })
          state.overrides[key] = false
          render()
        })

        toggleRow.appendChild(trueBtn)
        toggleRow.appendChild(falseBtn)

        if (hasOverride) {
          const restore = document.createElement('button')
          restore.className = 'editor-restore'
          restore.textContent = 'restore actual value'
          restore.addEventListener('click', (e) => {
            e.stopPropagation()
            send({ type: 'CLEAR_OVERRIDE', key })
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
          send({ type: 'SET_OVERRIDE', key, value: parsed })
          state.overrides[key] = parsed
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
          restore.textContent = 'restore actual value'
          restore.addEventListener('click', (e) => {
            e.stopPropagation()
            send({ type: 'CLEAR_OVERRIDE', key })
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

document.getElementById('clear-all-btn').addEventListener('click', () => {
  send({ type: 'CLEAR_ALL_OVERRIDES' })
  state.overrides = {}
  expandedKey = null
  render()
})

// Request current state from background on open
chrome.runtime.sendMessage({ type: 'GET_FLAGS' }, (response) => {
  if (response) {
    state = response
    render()
  }
})

// Listen for live updates while popup is open
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'FLAGS_UPDATE') {
    state.flags = msg.flags
    state.overrides = msg.overrides
    render()
  }
})
