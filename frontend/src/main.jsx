import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Filter,
  Home,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  List,
  LogOut,
  MoreVertical,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './style.css'

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('finance:unauthorized'))
    throw new Error(payload.detail || 'Something went wrong.')
  }
  return payload
}

const money = (amount, currency = 'BRL', compact = false) => {
  const value = Number(amount || 0)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'BRL',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
    }).format(value)
  } catch {
    return `${currency || 'BRL'} ${value.toFixed(2)}`
  }
}

const parseFinanceDate = (value) => {
  const day = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  return new Date(day ? `${day}T12:00:00` : value)
}

const dateLabel = (value, options = { month: 'short', day: 'numeric' }) => {
  if (!value) return '—'
  const date = parseFinanceDate(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', options).format(date)
}

const transactionCategory = (transaction, overrides) => overrides[transaction.id] || transaction.category || 'Uncategorized'
const isExpense = (transaction) => transaction.type === 'DEBIT' || (!transaction.type && Number(transaction.amount) < 0)
const isPosted = (transaction) => !transaction.status || transaction.status === 'POSTED'
const expenseValue = (transaction) => Math.abs(Number(transaction.amount || 0))
function displayAlias(displayAliases, kind, id) {
  return id == null ? '' : String(displayAliases?.[`${kind}:${id}`] || '').trim()
}

function displayAccountName(account, displayAliases = {}) {
  const isCard = account?.type === 'CREDIT' || account?._accountType === 'CREDIT'
  const id = account?.id ?? account?.accountId
  return displayAlias(displayAliases, isCard ? 'card' : 'account', id)
    || account?.name
    || account?.marketingName
    || (isCard ? 'Credit card' : 'Bank account')
}

function displayInstitutionName(itemId, fallback, displayAliases = {}) {
  return displayAlias(displayAliases, 'institution', itemId) || fallback || 'Connected institution'
}

function displayInstitutionForAccount(account, displayAliases = {}) {
  return displayInstitutionName(account?.itemId || account?._itemId, account?._institutionName || account?._itemName, displayAliases)
}

function transactionAccountLabel(transaction, displayAliases = {}) {
  const type = transaction?._accountType === 'CREDIT' ? 'card' : 'account'
  const accountId = transaction?.accountId || transaction?._accountId
  const accountName = displayAlias(displayAliases, type, accountId) || transaction?._accountName || 'Account'
  const itemId = transaction?._itemId || transaction?.itemId
  const institutionName = displayAlias(displayAliases, 'institution', itemId) || transaction?._itemName
  return institutionName ? `${accountName} · ${institutionName}` : accountName
}

const isInternalTransfer = (transaction, overrides = {}) => {
  const categoryId = String(transaction.categoryId || '')
  const category = String(transactionCategory(transaction, overrides)).trim().toLowerCase()
  const operationType = String(transaction.operationType || '').toUpperCase()
  return categoryId.startsWith('04')
    || categoryId.startsWith('0506')
    || categoryId.startsWith('0510')
    || category.startsWith('same person transfer')
    || category.startsWith('transfer - internal')
    || category === 'credit card payment'
    || operationType === 'PAGAMENTO_FATURA'
    || operationType === 'TRANSFERENCIA_MESMA_INSTITUICAO'
}
const isBankSlipTransaction = (transaction) => String(transaction.categoryId || '').startsWith('0501')
  || String(transaction.category || '').trim().toLowerCase() === 'transfer - bank slip'
const variableSpendCategoryPattern = /groceries|grocery|supermarket|mercado|mercearia|alimentacao|feira|hortifruti|sacolao|eating out|restaurant|dining|comer fora|lunch|restaurante|food delivery|delivery|ifood|rappi|uber eats|ubereats|food and drinks|shopping|compras|gas stations|fuel|gasoline|petrol|combustivel|posto|\bgas\b|diesel|vehicle maintenance|automotive|auto repair|clothing|vestuario|travel|viagem|entertainment|entretenimento|sports goods|hospital clinics|healthcare|pharmacy|farmacia|hospital|clinicas|personal care|beauty|pets|pet care|home goods|household|public transit|transportation|rideshare|ride share/i
const foodDeliveryPattern = /\b(food delivery|delivery|ifood|rappi|uber[ ._-]*eats|ubereats|99[ ._-]*food|aiqfome|takeaway|takeout)\b/i
const restaurantMealPattern = /restaurant|dining|eating out|comer fora|lunch|restaurante|refeicao|meal|food and drinks|food and drink|food & drinks|food & drink|restaurants? and bars|cafes?/i
const weekdayLunchGroup = {
  key: 'workday-lunches',
  label: 'Workday lunches',
  note: 'Restaurant purchases Monday–Friday from 11 a.m. to 3 p.m., using the time recorded by the institution.',
}
const foodDeliveryGroup = {
  key: 'food-delivery',
  label: 'Food delivery',
  note: 'Grouped by delivery service names or delivery-related category and transaction text.',
}
const eatingOutGroup = {
  key: 'eating-out',
  label: 'Eating out',
  note: 'Restaurant purchases outside the weekday lunch window, including evenings and weekends.',
}
const everydaySpendCategoryGroups = [
  { key: 'groceries', label: 'Groceries', pattern: /grocery|supermarket|mercado|mercearia|alimentacao|feira|hortifruti|sacolao/ },
  { key: 'restaurant-meals', label: 'Restaurant meals', pattern: restaurantMealPattern },
  { key: 'food-delivery', label: 'Food delivery', pattern: /food delivery|delivery|ifood|rappi|uber eats|takeaway|takeout/ },
  { key: 'fuel', label: 'Fuel & gas', pattern: /gas station|fuel|gasoline|petrol|combustivel|posto|gasolina|etanol|diesel|^gas$/ },
  { key: 'vehicle-maintenance', label: 'Vehicle maintenance', pattern: /vehicle maintenance|automotive|auto repair|car repair|vehicle|manutencao veicular|oficina|mecanica|automotivo/ },
  { key: 'clothing', label: 'Clothing', pattern: /clothing|vestuario|apparel/ },
  { key: 'shopping', label: 'Shopping', pattern: /shopping|compras/ },
  { key: 'travel', label: 'Travel', pattern: /travel|viagem/ },
  { key: 'entertainment', label: 'Entertainment', pattern: /entertainment|entretenimento/ },
  { key: 'healthcare', label: 'Healthcare', pattern: /hospital clinics|healthcare|pharmacy|farmacia|hospital|clinicas|clinica|saude/ },
  { key: 'sports-goods', label: 'Sports & fitness', pattern: /sports goods|sports|fitness|esportes/ },
  { key: 'personal-care', label: 'Personal care', pattern: /personal care|beauty|beleza|care products/ },
  { key: 'pets', label: 'Pets', pattern: /pets|pet care|veterinary|veterinario/ },
  { key: 'household', label: 'Household', pattern: /home goods|household|casa e jardim|casa/ },
  { key: 'transportation', label: 'Transportation', pattern: /public transit|transportation|transporte|transit|rideshare|ride share/ },
]

function everydaySpendCategory(category) {
  const normalized = String(category || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const known = everydaySpendCategoryGroups.find((group) => group.pattern.test(normalized))
  if (known) return known
  if (!variableSpendCategoryPattern.test(normalized)) return null
  const label = String(category || 'Other variable spending').trim()
  const key = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other-variable-spending'
  return { key: `category-${key}`, label }
}

function transactionBusinessDay(transaction) {
  const rawDate = String(transaction.date || '')
  const dateParts = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1).map(Number)
  if (!dateParts) return false
  const [year, month, day] = dateParts
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday >= 1 && weekday <= 5
}

function transactionRecordedHour(transaction) {
  // Some linked-bank timestamps preserve the institution's local clock despite a UTC suffix.
  // Reading the encoded clock avoids shifting lunchtime purchases by the UTC offset.
  const hour = String(transaction.date || '').match(/[T ](\d{2}):\d{2}/)?.[1]
  return hour === undefined ? null : Number(hour)
}

function classifyEverydaySpend(transaction, category) {
  const normalizedText = [category, recurringSource(transaction), transaction.description, transaction.descriptionRaw]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (foodDeliveryPattern.test(normalizedText)) return foodDeliveryGroup

  const categoryGroup = everydaySpendCategory(category)
  if (categoryGroup?.key === 'groceries') return categoryGroup
  const restaurantMeal = categoryGroup?.key === 'restaurant-meals' || restaurantMealPattern.test(normalizedText)
  if (restaurantMeal) {
    const hour = transactionRecordedHour(transaction)
    return transactionBusinessDay(transaction) && hour !== null && hour >= 11 && hour < 15
      ? weekdayLunchGroup
      : eatingOutGroup
  }
  return categoryGroup
}

function App() {
  const [session, setSession] = useState(null)
  const autoSyncLock = useRef(false)
  const appContentRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [periodDays, setPeriodDays] = useState(30)
  const [categoryFilter, setCategoryFilter] = useState('All categories')
  const [search, setSearch] = useState('')
  const [chartCurrency, setChartCurrency] = useState('BRL')
  const [activeTab, setActiveTab] = useState('home')
  const lastSyncLabel = data?.lastSyncedAt
    ? `Synced ${new Date(data.lastSyncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : 'Private dashboard'

  const loadSession = useCallback(async () => {
    try {
      const status = await api('/api/session')
      setSession(status)
      if (status.authenticated) await loadDashboard()
      else setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api('/api/dashboard'))
      setError('')
    } catch (err) {
      setError(err.message)
      if (err.message.includes('Sign in')) setSession((current) => ({ ...current, authenticated: false }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSession()
    const expire = () => setSession((current) => ({ ...current, authenticated: false }))
    window.addEventListener('finance:unauthorized', expire)
    return () => window.removeEventListener('finance:unauthorized', expire)
  }, [loadSession])

  const refresh = async () => {
    setRefreshing(true)
    setMessage('Refreshing connected accounts…')
    setError('')
    try {
      const result = await api('/api/sync', { method: 'POST' })
      await loadDashboard()
      const synced = result.results?.filter((item) => item.synced).length || 0
      const waiting = result.results?.filter((item) => !item.synced && !item.error).length || 0
      setMessage(waiting ? `Updated ${synced} connection${synced === 1 ? '' : 's'} · ${waiting} still syncing` : `Updated ${synced} connection${synced === 1 ? '' : 's'}`)
      const failed = result.results?.filter((item) => item.error)
      if (failed?.length) setError(failed.map((item) => item.error).join(' · '))
    } catch (err) {
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  const autoSyncIfDue = useCallback(async () => {
    if (!session?.authenticated || autoSyncLock.current) return
    autoSyncLock.current = true
    setRefreshing(true)
    try {
      const result = await api('/api/sync-if-due', { method: 'POST' })
      if (result.skipped) return
      await loadDashboard()
      const failed = result.results?.filter((item) => item.error) || []
      if (failed.length) setError(failed.map((item) => item.error).join(' · '))
    } catch (err) {
      setError(err.message)
    } finally {
      autoSyncLock.current = false
      setRefreshing(false)
    }
  }, [session?.authenticated, loadDashboard])

  useEffect(() => {
    if (!session?.authenticated) return undefined
    void autoSyncIfDue()
    const timer = window.setInterval(() => void autoSyncIfDue(), 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [session?.authenticated, autoSyncIfDue])

  const importExisting = async () => {
    setImporting(true)
    setMessage('Looking for existing Pluggy connections…')
    setError('')
    try {
      const result = await api('/api/import-existing', { method: 'POST' })
      await loadDashboard()
      const synced = result.results?.filter((item) => item.synced).length || 0
      const waiting = result.results?.filter((item) => !item.synced && !item.error).length || 0
      setMessage(result.discovered
        ? waiting
          ? `Found ${result.discovered} existing connection${result.discovered === 1 ? '' : 's'} · ${synced} synced · ${waiting} still syncing`
          : `Imported ${synced} of ${result.discovered} existing connection${result.discovered === 1 ? '' : 's'}`
        : 'No existing connections were listed for these API credentials. You can import a known Item ID below.')
      const failed = result.results?.filter((item) => item.error)
      if (failed?.length) setError(failed.map((item) => item.error).join(' · '))
    } catch (err) {
      setMessage('')
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const importItemId = async (itemId) => {
    setImporting(true)
    setMessage('Importing the existing Pluggy connection…')
    setError('')
    try {
      const result = await api(`/api/items/${encodeURIComponent(itemId)}/sync`, { method: 'POST' })
      await loadDashboard()
      setMessage(result.synced ? 'Existing connection imported and synced.' : `Connection found (${result.status || result.executionStatus || 'still syncing'}). Use Refresh in a moment.`)
    } catch (err) {
      setMessage('')
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  const connect = async (itemId = null) => {
    if (!window.PluggyConnect) {
      setError('Pluggy Connect did not load. Check your internet connection and reload this page.')
      return
    }
    setConnecting(true)
    setError('')
    try {
      const suffix = itemId ? `?itemId=${encodeURIComponent(itemId)}` : ''
      const { accessToken } = await api(`/api/connect-token${suffix}`, { method: 'POST' })
      const widget = new window.PluggyConnect({
        connectToken: accessToken,
        updateItem: itemId || undefined,
        includeSandbox: session?.includeSandbox || false,
        theme: 'light',
        onSuccess: async ({ item }) => {
          setMessage('Connection complete. Syncing your account data…')
          try {
            const syncResult = await api(`/api/items/${encodeURIComponent(item.id)}/sync`, { method: 'POST' })
            await loadDashboard()
            setMessage(syncResult.synced ? 'Account data is up to date.' : 'The connection is still syncing. Use Refresh in a moment.')
          } catch (err) {
            setError(err.message)
          } finally {
            setConnecting(false)
          }
        },
        onError: async ({ message: widgetMessage, data: errorData }) => {
          const failedItemId = errorData?.item?.id
          if (failedItemId) {
            try { await api(`/api/items/${encodeURIComponent(failedItemId)}/sync`, { method: 'POST' }); await loadDashboard() } catch { /* keep the widget error visible */ }
          }
          setError(widgetMessage || 'The account connection could not be completed.')
          setConnecting(false)
        },
        onClose: () => setConnecting(false),
      })
      widget.init()
    } catch (err) {
      setError(err.message)
      setConnecting(false)
    }
  }

  const logout = async () => {
    try { await api('/api/logout', { method: 'POST' }) } catch { /* clear local state below */ }
    setSession((current) => ({ ...current, authenticated: false }))
    setData(null)
  }

  if (loading && !session) return <LoadingScreen />
  if (!session?.authenticated) {
    return <LoginScreen configured={session?.configured} onLogin={() => { setSession((current) => ({ ...current, authenticated: true })); loadDashboard() }} />
  }

  return (
    <div className="app-shell min-h-screen w-full min-w-0 bg-paper text-ink">
      <div ref={appContentRef} className="app-content mx-auto w-full min-w-0 max-w-[1480px] px-4 py-5 sm:px-5 md:px-9 md:py-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="brand-mark"><Landmark size={21} strokeWidth={2.1} /></div>
            <div>
              <div className="font-display text-[17px] font-extrabold leading-5 tracking-tight">Finance</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Personal finance</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-[#e8ede9] bg-white px-3 py-2 text-xs font-medium text-muted sm:flex">
              <span className="status-dot" /> {lastSyncLabel}
            </div>
            <button className="icon-button" onClick={logout} title="Sign out"><LogOut size={17} /></button>
          </div>
        </header>

        {(error || message) && <Notice error={error} message={message} onClose={() => { setError(''); setMessage('') }} />}

        {activeTab === 'home' && <>
          <section className="mb-7 grid w-full min-w-0 gap-5 xl:grid-cols-[1.45fr_0.85fr]">
            <BalanceHero data={data} onRefresh={refresh} refreshing={refreshing} />
            <div className="month-stats-grid grid min-w-0 gap-4">
              <MonthStat data={data} kind="expenses" />
              <MonthStat data={data} kind="income" />
              <MonthStat data={data} kind="cards" />
              <MonthStat data={data} kind="movements" />
              <p className="col-span-1 px-1 text-[10px] leading-relaxed text-muted md:col-span-2">Monthly figures show posted activity this month. Available balance is a current bank-account snapshot that includes money carried in from earlier months; card purchases can appear as spending before payment leaves your bank account.</p>
            </div>
          </section>
          <ExpenseChart data={data} days={periodDays} setDays={setPeriodDays} currency={chartCurrency} setCurrency={setChartCurrency} />
        </>}

        {activeTab === 'outlook' && <RecurringDashboard
          data={data}
          onRuleSave={async (patternKey, rule) => {
            const saved = await api(`/api/recurring-patterns/${encodeURIComponent(patternKey)}`, {
              method: 'PUT',
              body: JSON.stringify(rule),
            })
            setData((current) => ({ ...current, recurringRules: { ...(current?.recurringRules || {}), [patternKey]: { alias: saved.alias, categoryAllocations: saved.categoryAllocations || [], excluded: saved.excluded } } }))
            setMessage(saved.excluded ? 'Recurring pattern excluded from monthly expenses.' : 'Recurring pattern preference saved.')
          }}
        />}

        {activeTab === 'transactions' && <TransactionsPanel
          data={data}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          search={search}
          setSearch={setSearch}
          onCategorySave={async (transactionId, category) => {
            try {
              await api(`/api/transactions/${encodeURIComponent(transactionId)}/category`, {
                method: 'PATCH',
                body: JSON.stringify({ category }),
              })
              await loadDashboard()
              setMessage(category ? 'Category updated.' : 'Category reset to Pluggy’s suggestion.')
            } catch (err) { setError(err.message) }
          }}
          onBulkCategorySave={async (transactionIds, category) => {
            const result = await api('/api/transactions/categories', {
              method: 'PATCH',
              body: JSON.stringify({ transaction_ids: transactionIds, category }),
            })
            await loadDashboard()
            setMessage(`Updated ${result.updated} similar expenses to “${category}”.`)
          }}
          onGroupVisibilityChange={async (group, hidden) => {
            const path = `/api/similar-expense-groups/${encodeURIComponent(group.key)}/hide`
            const result = await api(path, hidden
              ? { method: 'PUT', body: JSON.stringify({ categories: group.categories.map(([category]) => category) }) }
              : { method: 'DELETE' })
            setData((current) => {
              const reviewedExpenseGroups = { ...(current?.reviewedExpenseGroups || {}) }
              if (hidden) reviewedExpenseGroups[group.key] = result.categories
              else delete reviewedExpenseGroups[group.key]
              return { ...current, reviewedExpenseGroups }
            })
            setMessage(hidden ? 'Group hidden from category review.' : 'Group restored to category review.')
          }}
        />}

        {activeTab === 'accounts' && <>
          <CreditAndSlipsDashboard data={data} />
          <InstallmentBillsDashboard data={data} />
          <AccountsPanel data={data} onConnect={connect} connecting={connecting} onImportExisting={importExisting} onImportItemId={importItemId} importing={importing} onAliasSave={async (aliasKey, alias) => {
            const saved = await api('/api/display-aliases', { method: 'PUT', body: JSON.stringify({ alias_key: aliasKey, alias }) })
            setData((current) => {
              const displayAliases = { ...(current?.displayAliases || {}) }
              if (saved.alias) displayAliases[aliasKey] = saved.alias
              else delete displayAliases[aliasKey]
              return { ...current, displayAliases }
            })
            setMessage(saved.alias ? 'Display alias saved.' : 'Display alias cleared.')
          }} />
        </>}

        <footer className="mt-7 flex flex-col justify-between gap-2 border-t border-[#e8ede9] py-5 pb-24 text-[11px] text-muted sm:flex-row sm:items-center">
          <span>Financial data is read from your linked institutions through Pluggy.</span>
          <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> Private to this app</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Main navigation">
        {[
          { id: 'home', label: 'Home', icon: Home },
          { id: 'outlook', label: 'Outlook', icon: TrendingUp },
          { id: 'transactions', label: 'Transactions', icon: List },
          { id: 'accounts', label: 'Accounts', icon: Landmark },
        ].map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`bottom-nav-item ${activeTab === id ? 'bottom-nav-item-active' : ''}`} aria-current={activeTab === id ? 'page' : undefined} onClick={() => {
          setActiveTab(id)
          const isMobileLayout = window.matchMedia('(max-width: 639px)').matches
          if (isMobileLayout) appContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
          else window.scrollTo({ top: 0, behavior: 'smooth' })
        }}>
          <Icon size={19} strokeWidth={activeTab === id ? 2.4 : 1.9} /><span>{label}</span>
        </button>)}
      </nav>
    </div>
  )
}

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-paper text-muted"><LoaderCircle className="mr-2 animate-spin" size={19} /> Loading your dashboard…</div>
}

function LoginScreen({ configured, onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) })
      onLogin({ authenticated: true, configured: true })
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="brand-mark mb-7"><Landmark size={21} /></div>
        <p className="eyebrow">Your private money space</p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-tight">Welcome back.</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Sign in to see your accounts, cards, and recent spending.</p>
        {!configured && <div className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Set <code>APP_PASSWORD</code> and <code>SESSION_SECRET</code> in the app’s <code>.env</code> file, then restart it.</div>}
        <form onSubmit={submit} className="mt-7">
          <label htmlFor="password" className="mb-2 block text-xs font-bold text-ink">App password</label>
          <div className="relative">
            <LockKeyhole size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input id="password" autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="input pl-10" placeholder="Enter your password" />
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <button disabled={busy || !configured} className="primary-button mt-5 w-full justify-center">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <LockKeyhole size={16} />} Unlock dashboard</button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted"><ShieldCheck size={13} /> Protected with an environment password</p>
      </div>
    </main>
  )
}

function Notice({ error, message, onClose }) {
  return <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>
    {error ? <CircleHelp size={17} /> : <Check size={17} />}
    <span>{error || message}</span>
    <button className="ml-auto opacity-60 hover:opacity-100" onClick={onClose}><X size={15} /></button>
  </div>
}

function BalanceHero({ data, onRefresh, refreshing }) {
  const accounts = data?.accounts || []
  const cashByCurrency = accounts.filter((account) => account.type === 'BANK').reduce((totals, account) => {
    const currency = account.currencyCode || 'BRL'
    const amount = Number(account.balance || 0)
    totals[currency] = (totals[currency] || 0) + amount
    return totals
  }, {})
  const cardByCurrency = accounts.filter((account) => account.type === 'CREDIT').reduce((totals, account) => {
    const currency = account.currencyCode || 'BRL'
    totals[currency] = (totals[currency] || 0) + Number(account.balance || 0)
    return totals
  }, {})
  const currencies = [...new Set([...Object.keys(cashByCurrency), ...Object.keys(cardByCurrency)])]
  const currency = cashByCurrency.BRL !== undefined ? 'BRL' : Object.keys(cashByCurrency)[0] || Object.keys(cardByCurrency)[0] || 'BRL'
  const availableBalance = cashByCurrency[currency] || 0
  const netAfterCards = availableBalance - (cardByCurrency[currency] || 0)
  const bankAccountCount = accounts.filter((account) => account.type === 'BANK').length
  const otherCurrencies = Object.keys(cashByCurrency).filter((code) => code !== currency)
  return (
    <div className="balance-hero relative flex min-h-[220px] w-full min-w-0 flex-col justify-between overflow-hidden rounded-[26px] p-6 text-white md:p-8">
      <div className="hero-orb hero-orb-one" /><div className="hero-orb hero-orb-two" />
      <div className="relative z-10 flex items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-white/75">Available bank balance</p><p className="mt-1 text-xs text-white/55">For spending, transfers, and withdrawals</p></div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-white/10 bg-white/10 p-2.5"><Wallet size={19} /></div>
          <button className="hero-refresh-button" type="button" onClick={onRefresh} disabled={refreshing} title="Refresh connected accounts" aria-label="Refresh connected accounts"><RefreshCw className={refreshing ? 'animate-spin' : ''} size={18} /></button>
        </div>
      </div>
      <div className="relative z-10 mt-7">
        <p className="font-display text-4xl font-extrabold tracking-[-0.04em] md:text-5xl">{money(availableBalance, currency)}</p>
        <p className="mt-2 text-xs text-white/55">Across {bankAccountCount} bank account{bankAccountCount === 1 ? '' : 's'} · credit cards excluded</p>
        <p className="mt-4 border-t border-white/15 pt-3 text-xs font-medium text-white/70">After open card balances <span className="ml-1 font-display text-sm font-extrabold text-white">{money(netAfterCards, currency)}</span></p>
      </div>
      {otherCurrencies.length > 0 && <div className="relative z-10 mt-5 flex flex-wrap gap-2">{otherCurrencies.map((code) => <span key={code} className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80">{code} {money(cashByCurrency[code], code)}</span>)}</div>}
    </div>
  )
}

function MonthStat({ data, kind }) {
  const transactions = data?.transactions || []
  const overrides = data?.categoryOverrides || {}
  const accountCurrencies = [...new Set((data?.accounts || []).map((account) => account.currencyCode).filter(Boolean))]
  const currency = accountCurrencies.includes('BRL') ? 'BRL' : accountCurrencies[0] || 'BRL'
  const currentMonth = currentFinanceMonth()
  const current = transactions.filter((tx) => {
    const date = parseFinanceDate(tx.date)
    return !Number.isNaN(date.getTime()) && String(tx.date || '').slice(0, 7) === currentMonth && isPosted(tx) && (tx.currencyCode || 'BRL') === currency
  })
  const exp = current.filter((tx) => isExpense(tx) && !isInternalTransfer(tx, overrides)).reduce((sum, tx) => sum + expenseValue(tx), 0)
  const income = current.filter((tx) => !isExpense(tx) && tx._accountType !== 'CREDIT' && !isInternalTransfer(tx, overrides)).reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0)
  const cards = (data?.accounts || []).filter((account) => account.type === 'CREDIT' && (account.currencyCode || 'BRL') === currency)
  const cardBalance = cards.reduce((sum, account) => sum + Math.max(0, Number(account.balance || 0)), 0)
  const values = {
    expenses: { label: 'Spent this month', value: money(exp, currency), icon: <ArrowDownRight size={17} />, tone: 'rose', note: `Posted spending, excluding transfers · ${currency}` },
    income: { label: 'Income this month', value: money(income, currency), icon: <ArrowUpRight size={17} />, tone: 'green', note: `Bank income, excluding transfers · ${currency}` },
    cards: { label: 'Open card balances', value: money(cardBalance, currency), icon: <CreditCard size={17} />, tone: 'violet', note: `${cards.length} credit card${cards.length === 1 ? '' : 's'} · ${currency}` },
    movements: { label: 'Movements available', value: transactions.length.toLocaleString('en-US'), icon: <ArrowLeftRight size={17} />, tone: 'blue', note: 'Up to 12 months from Pluggy' },
  }
  const item = values[kind]
  return <div className="stat-card flex min-h-[126px] flex-col justify-between rounded-2xl bg-white p-4 shadow-soft md:p-5">
    <div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-muted">{item.label}</span><span className={`stat-icon stat-${item.tone}`}>{item.icon}</span></div>
    <div><p className="font-display text-xl font-extrabold tracking-tight">{item.value}</p><p className="mt-1 text-[10px] text-muted">{item.note}</p></div>
  </div>
}

function recurringSource(tx) {
  const merchant = tx.merchant
  const merchantName = typeof merchant === 'string'
    ? merchant
    : merchant?.name || merchant?.businessName || merchant?.displayName
  const rawLabel = merchantName || tx.descriptionRaw || tx.description || ''
  const pieces = String(rawLabel).split('|').map((piece) => piece.trim()).filter(Boolean)
  return pieces.length > 1 ? pieces.slice(1).join(' · ') : pieces[0] || 'Unknown source'
}

function normalizeRecurringSource(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function recurringTransferSource(tx) {
  const raw = String(tx.descriptionRaw || tx.description || '').trim()
  const pieces = raw.split('|').map((piece) => piece.trim()).filter(Boolean)
  const describedRecipient = pieces.length > 1
    ? pieces.slice(1).join(' · ')
    : raw.replace(/^(pix enviado pelo pix|pix enviado|transferencia enviada pelo pix|transferencia enviada|pix)\s*/i, '')
      .replace(/\s+(com saldo|via pix|pelo pix)$/i, '')
      .trim()
  const generic = /^(pix|pix enviado|pix recebido|transferencia|transferencia enviada|transferencia recebida|transferencia enviada pelo pix)$/i
  if (describedRecipient && !generic.test(describedRecipient)) return describedRecipient
  const merchant = tx.merchant
  return (typeof merchant === 'string' ? merchant : merchant?.name || merchant?.businessName || merchant?.displayName) || describedRecipient
}

function recurringAccountLabel(transaction, displayAliases = {}) {
  return transactionAccountLabel(transaction, displayAliases)
}

function isCommonTaxOrFee(transaction) {
  const label = normalizeRecurringSource(`${recurringSource(transaction)} ${transaction.category || ''} ${transaction.description || ''} ${transaction.descriptionRaw || ''}`)
  return /\b(?:iof|tax(?:a|as|es)?|fees?|tarifas?|tariff|encargos?|impostos?|tributos?|anuidade|service charge|maintenance fee|bank charge)\b/.test(label)
}

function isRecurringExternalTransfer(tx, overrides = {}) {
  const categoryId = String(tx.categoryId || '')
  const operationType = String(tx.operationType || '').toUpperCase()
  const merchant = typeof tx.merchant === 'string' ? tx.merchant : tx.merchant?.name || ''
  const label = `${tx.descriptionRaw || ''} ${tx.description || ''} ${merchant}`
  const explicitlyPix = categoryId.startsWith('0507')
  const generalTransferPix = categoryId.startsWith('0500') && operationType === 'PIX'
  if ((!explicitlyPix && !generalTransferPix)
    || tx._accountType === 'CREDIT'
    || isInternalTransfer(tx, overrides)
    || isBankSlipTransaction(tx)
    || operationType === 'CARTAO'
    || operationType === 'PAGAMENTO_FATURA'
    || /fatura|cartao|cartão|boleto|bank slip/i.test(label)) return false

  const source = normalizeRecurringSource(recurringTransferSource(tx))
    .replace(/^(pix enviado pelo pix|pix enviado|transferencia enviada pelo pix|transferencia enviada|pix)\s+/, '')
    .replace(/\b(com saldo|via pix|pelo pix|pix)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return source.length >= 4 && !/^(pix|transferencia|transferencia enviada|transferencia recebida|pagamento)$/.test(source)
}

function analyzeMonthlyPattern(transactions, overrides, displayAliases = {}) {
  const groups = new Map()
  const genericSources = /^(pix|pix recebido|pix enviado|transferencia|transferencia recebida|transferencia enviada|pagamento|compra|debito|credito|debit|credit)$/

  for (const tx of transactions) {
    const date = parseFinanceDate(tx.date)
    if (Number.isNaN(date.getTime())) continue
    const transferPattern = isRecurringExternalTransfer(tx, overrides)
    const taxFeePattern = !transferPattern && isCommonTaxOrFee(tx)
    const source = transferPattern ? recurringTransferSource(tx) : taxFeePattern ? 'Taxes & fees' : recurringSource(tx)
    const key = taxFeePattern ? 'common-taxes-and-fees' : normalizeRecurringSource(source)
    if (key.length < 4 || genericSources.test(key)) continue

    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const category = transactionCategory(tx, overrides)
    if (!groups.has(key)) groups.set(key, { key, source, categoryCounts: new Map(), months: new Map(), rows: [], transferPattern: false, taxFeePattern: false })
    const group = groups.get(key)
    group.source = source
    group.transferPattern ||= transferPattern
    group.taxFeePattern ||= taxFeePattern
    group.rows.push(tx)
    group.categoryCounts.set(category, (group.categoryCounts.get(category) || 0) + 1)
    group.months.set(month, (group.months.get(month) || 0) + Math.abs(Number(tx.amount || 0)))
  }

  return [...groups.values()].map((group) => {
    const allMonthKeys = [...group.months.keys()].sort()
    const allMonthNumbers = allMonthKeys.map((month) => {
      const [year, number] = month.split('-').map(Number)
      return year * 12 + number
    })
    const runs = []
    let currentRun = []
    allMonthKeys.forEach((month, index) => {
      if (index > 0 && allMonthNumbers[index] - allMonthNumbers[index - 1] > 2) {
        if (currentRun.length) runs.push(currentRun)
        currentRun = []
      }
      currentRun.push(month)
    })
    if (currentRun.length) runs.push(currentRun)
    const monthKeys = runs.sort((a, b) => b.length - a.length || b.at(-1).localeCompare(a.at(-1)))[0] || []
    const monthSet = new Set(monthKeys)
    const rows = group.rows.filter((tx) => {
      const date = parseFinanceDate(tx.date)
      return monthSet.has(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
    })
    const amounts = monthKeys.map((month) => group.months.get(month) || 0)
    const monthNumbers = monthKeys.map((month) => {
      const [year, number] = month.split('-').map(Number)
      return year * 12 + number
    })
    const largestGap = Math.max(0, ...monthNumbers.slice(1).map((number, index) => number - monthNumbers[index]))
    const mean = amounts.reduce((sum, amount) => sum + amount, 0) / Math.max(1, amounts.length)
    const variance = amounts.reduce((sum, amount) => sum + ((amount - mean) ** 2), 0) / Math.max(1, amounts.length)
    const categoryCounts = new Map()
    const categoryTotals = new Map()
    const transactionCountsByMonth = new Map()
    const sourceAccountsByMonth = new Map()
    for (const tx of rows) {
      const category = transactionCategory(tx, overrides)
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + Math.abs(Number(tx.amount || 0)))
    }
    for (const tx of group.rows) {
      const date = parseFinanceDate(tx.date)
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      transactionCountsByMonth.set(month, (transactionCountsByMonth.get(month) || 0) + 1)
      if (!sourceAccountsByMonth.has(month)) sourceAccountsByMonth.set(month, new Set())
      sourceAccountsByMonth.get(month).add(recurringAccountLabel(tx, displayAliases))
    }
    const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Uncategorized'
    const categoryAmounts = [...categoryTotals.entries()]
      .map(([name, amount]) => ({ category: name, amount: amount / Math.max(1, monthKeys.length) }))
      .sort((a, b) => b.amount - a.amount)
    const categoryAmountsByMonth = new Map()
    for (const tx of group.rows) {
      const date = parseFinanceDate(tx.date)
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      if (!categoryAmountsByMonth.has(month)) categoryAmountsByMonth.set(month, new Map())
      const monthCategories = categoryAmountsByMonth.get(month)
      const name = transactionCategory(tx, overrides)
      monthCategories.set(name, (monthCategories.get(name) || 0) + Math.abs(Number(tx.amount || 0)))
    }
    const sourceAccounts = [...new Set(rows.map((tx) => recurringAccountLabel(tx, displayAliases)))].sort((a, b) => a.localeCompare(b))
    const taxFeeDetails = group.taxFeePattern
      ? [...new Set(group.rows.map((tx) => recurringSource(tx)).filter(Boolean))].map((sourceName) => {
        const detailRows = rows.filter((tx) => recurringSource(tx) === sourceName)
        const allDetailRows = group.rows.filter((tx) => recurringSource(tx) === sourceName)
        const monthlyTotals = new Map()
        const allMonthlyTotals = new Map()
        for (const tx of detailRows) {
          const date = parseFinanceDate(tx.date)
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          monthlyTotals.set(month, (monthlyTotals.get(month) || 0) + Math.abs(Number(tx.amount || 0)))
        }
        for (const tx of allDetailRows) {
          const date = parseFinanceDate(tx.date)
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          allMonthlyTotals.set(month, (allMonthlyTotals.get(month) || 0) + Math.abs(Number(tx.amount || 0)))
        }
        return {
          source: sourceName,
          mean: [...monthlyTotals.values()].reduce((sum, amount) => sum + amount, 0) / Math.max(1, monthKeys.length),
          monthlyAmounts: allMonthlyTotals,
          accounts: [...new Set(allDetailRows.map((tx) => recurringAccountLabel(tx, displayAliases)))].sort((a, b) => a.localeCompare(b)),
        }
      }).sort((a, b) => b.mean - a.mean)
      : []
    const latest = [...rows].sort((a, b) => parseFinanceDate(b.date) - parseFinanceDate(a.date))[0]
    return {
      ...group,
      rows,
      category,
      categoryAmounts,
      categoryAmountsByMonth: new Map([...categoryAmountsByMonth.entries()].map(([month, totals]) => [month, [...totals.entries()].map(([name, amount]) => ({ category: name, amount })).sort((a, b) => b.amount - a.amount)])),
      sourceAccounts,
      sourceAccountsByMonth: new Map([...sourceAccountsByMonth.entries()].map(([month, accounts]) => [month, [...accounts].sort((a, b) => a.localeCompare(b))])),
      taxFeeDetails,
      latestDate: latest?.date,
      monthKeys,
      monthCount: monthKeys.length,
      mean,
      coefficientOfVariation: mean ? Math.sqrt(variance) / mean : 0,
      monthlyAmounts: new Map(monthKeys.map((month) => [month, group.months.get(month) || 0])),
      allMonthlyAmounts: new Map(group.months),
      allMonthlyCounts: transactionCountsByMonth,
      largestGap,
      isMonthly: monthKeys.length >= 3 && largestGap <= 2,
    }
  }).filter((group) => group.isMonthly)
}

function buildEverydaySpendPatterns(transactions, overrides, displayAliases = {}) {
  const groups = new Map()
  for (const transaction of transactions) {
    if (!isExpense(transaction)
      || isInternalTransfer(transaction, overrides)
      || String(transaction.categoryId || '').startsWith('05')
      || isBankSlipTransaction(transaction)) continue
    const category = transactionCategory(transaction, overrides)
    if (/investment|investimento/i.test(category)) continue
    const categoryGroup = classifyEverydaySpend(transaction, category)
    if (!categoryGroup) continue
    const date = parseFinanceDate(transaction.date)
    if (Number.isNaN(date.getTime())) continue
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const key = `everyday-category:${categoryGroup.key}`
    if (!groups.has(key)) groups.set(key, {
      key,
      source: categoryGroup.label,
      category: categoryGroup.label,
      classificationNote: categoryGroup.note || '',
      rows: [],
      months: new Map(),
      monthlyCounts: new Map(),
      monthlyAccounts: new Map(),
      categories: new Map(),
      categoryMonths: new Map(),
      merchants: new Map(),
    })
    const group = groups.get(key)
    const amount = expenseValue(transaction)
    group.rows.push(transaction)
    group.months.set(month, (group.months.get(month) || 0) + amount)
    group.monthlyCounts.set(month, (group.monthlyCounts.get(month) || 0) + 1)
    if (!group.monthlyAccounts.has(month)) group.monthlyAccounts.set(month, new Set())
    group.monthlyAccounts.get(month).add(recurringAccountLabel(transaction, displayAliases))
    const displayCategory = ['workday-lunches', 'food-delivery', 'eating-out'].includes(categoryGroup.key)
      ? categoryGroup.label
      : category
    const categoryTotals = group.categories.get(displayCategory) || { total: 0, count: 0 }
    categoryTotals.total += amount
    categoryTotals.count += 1
    group.categories.set(displayCategory, categoryTotals)
    if (!group.categoryMonths.has(month)) group.categoryMonths.set(month, new Map())
    const monthCategories = group.categoryMonths.get(month)
    monthCategories.set(displayCategory, (monthCategories.get(displayCategory) || 0) + amount)
    const merchant = recurringSource(transaction)
    const merchantKey = normalizeRecurringSource(merchant) || 'unknown source'
    if (!group.merchants.has(merchantKey)) group.merchants.set(merchantKey, {
      source: merchant,
      total: 0,
      count: 0,
      months: new Set(),
      rows: [],
      monthlyAmounts: new Map(),
      monthlyCounts: new Map(),
      monthlyAccounts: new Map(),
    })
    const merchantGroup = group.merchants.get(merchantKey)
    merchantGroup.total += amount
    merchantGroup.count += 1
    merchantGroup.months.add(month)
    merchantGroup.rows.push(transaction)
    merchantGroup.monthlyAmounts.set(month, (merchantGroup.monthlyAmounts.get(month) || 0) + amount)
    merchantGroup.monthlyCounts.set(month, (merchantGroup.monthlyCounts.get(month) || 0) + 1)
    if (!merchantGroup.monthlyAccounts.has(month)) merchantGroup.monthlyAccounts.set(month, new Set())
    merchantGroup.monthlyAccounts.get(month).add(recurringAccountLabel(transaction, displayAliases))
  }

  return [...groups.values()].map((group) => {
    const monthKeys = [...group.months.keys()].sort()
    const total = [...group.months.values()].reduce((sum, amount) => sum + amount, 0)
    const sourceAccounts = [...new Set(group.rows.map((transaction) => recurringAccountLabel(transaction, displayAliases)))].sort((a, b) => a.localeCompare(b))
    const categoryAmounts = [...group.categories.entries()]
      .map(([category, values]) => ({ category, amount: values.total / 12 }))
      .sort((a, b) => b.amount - a.amount)
    const merchantDetails = [...group.merchants.values()]
      .map((merchant) => ({
        source: merchant.source,
        mean: merchant.total / 12,
        count: merchant.count,
        months: merchant.months.size,
        accounts: [...new Set(merchant.rows.map((transaction) => recurringAccountLabel(transaction, displayAliases)))].sort((a, b) => a.localeCompare(b)),
        monthlyAmounts: merchant.monthlyAmounts,
        monthlyCounts: merchant.monthlyCounts,
        monthlyAccounts: merchant.monthlyAccounts,
      }))
      .sort((a, b) => b.mean - a.mean)
    return {
      ...group,
      source: `${group.source} across merchants`,
      rows: group.rows,
      categoryAmounts,
      categoryAmountsByMonth: new Map([...group.categoryMonths.entries()].map(([month, totals]) => [month, [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)])),
      sourceAccounts,
      sourceAccountsByMonth: new Map([...group.monthlyAccounts.entries()].map(([month, accounts]) => [month, [...accounts].sort((a, b) => a.localeCompare(b))])),
      merchantDetails,
      merchantCount: group.merchants.size,
      taxFeeDetails: [],
      transferPattern: false,
      taxFeePattern: false,
      categoryPattern: true,
      classificationNote: group.classificationNote,
      latestDate: [...group.rows].sort((a, b) => parseFinanceDate(b.date) - parseFinanceDate(a.date))[0]?.date,
      monthKeys,
      monthCount: monthKeys.length,
      mean: total / 12,
      coefficientOfVariation: 0,
      monthlyAmounts: new Map(monthKeys.map((month) => [month, group.months.get(month) || 0])),
      allMonthlyAmounts: new Map(group.months),
      allMonthlyCounts: new Map(group.monthlyCounts),
      largestGap: 0,
      isMonthly: group.key === 'everyday-category:workday-lunches'
        ? monthKeys.length >= 2 && group.rows.length >= 3
        : monthKeys.length >= 5,
    }
  }).filter((group) => group.isMonthly)
}

function buildRecurringInsights(data, preferredCurrency = null) {
  const accounts = data?.accounts || []
  const accountCurrencies = [...new Set(accounts.map((account) => account.currencyCode).filter(Boolean))]
  const currency = accountCurrencies.includes(preferredCurrency)
    ? preferredCurrency
    : accountCurrencies.includes('BRL') ? 'BRL' : accountCurrencies[0] || 'BRL'
  const currentMonth = currentFinanceMonth()
  const firstMonth = shiftOutlookMonth(currentMonth, -11)
  const recent = (data?.transactions || []).filter((tx) => {
    const date = parseFinanceDate(tx.date)
    const month = String(tx.date || '').slice(0, 7)
    return !Number.isNaN(date.getTime())
      && month >= firstMonth
      && month <= currentMonth
      && isPosted(tx)
      && (tx.currencyCode || 'BRL') === currency
  })
  const overrides = data?.categoryOverrides || {}
  const displayAliases = data?.displayAliases || {}
  const expenseRows = recent.filter((tx) => {
    const category = transactionCategory(tx, overrides).toLowerCase()
    const ordinaryExpense = !isInternalTransfer(tx, overrides)
      && !String(tx.categoryId || '').startsWith('05')
      && !isBankSlipTransaction(tx)
    return isExpense(tx)
      && (ordinaryExpense || isRecurringExternalTransfer(tx, overrides))
      && !category.includes('investment')
      && !category.includes('investimento')
      && !variableSpendCategoryPattern.test(category.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  })
  const recurringRules = data?.recurringRules || {}
  const sourcePatterns = analyzeMonthlyPattern(expenseRows, overrides, displayAliases)
    .filter((group) => group.monthCount >= 5 && (!group.transferPattern || group.rows.filter((tx) => isRecurringExternalTransfer(tx, overrides)).length >= 5))
  const everydayPatterns = buildEverydaySpendPatterns(recent, overrides, displayAliases)
  const recurringExpenses = [...sourcePatterns, ...everydayPatterns]
    .map((group) => ({
      ...group,
      alias: recurringRules[group.key]?.alias || '',
      categoryAllocations: recurringRules[group.key]?.categoryAllocations || [],
      excluded: Boolean(recurringRules[group.key]?.excluded),
    }))
    .sort((a, b) => b.mean - a.mean)

  const salaryWords = /salary|sal[aá]rio|folha|payroll|ordenado|remunera|holerite/i
  const excludedIncomeWords = /interest|juros|dividend|dividendo|rendimento|investimento|resgate|cashback|reembolso/i
  const incomeRows = recent.filter((tx) => {
    const label = `${tx.descriptionRaw || ''} ${tx.description || ''} ${tx.category || ''}`
    return tx._accountType !== 'CREDIT'
      && !isExpense(tx)
      && Number(tx.amount) > 0
      && !isInternalTransfer(tx, overrides)
      && !String(tx.categoryId || '').startsWith('05')
      && !excludedIncomeWords.test(label)
  })
  const recurringIncome = analyzeMonthlyPattern(incomeRows, overrides, displayAliases)
    .filter((group) => group.monthCount >= 3 && group.coefficientOfVariation <= 0.3)
  const explicitSalary = recurringIncome.filter((group) => salaryWords.test(`${group.source} ${group.category}`))
  const salaryGroups = explicitSalary.length
    ? explicitSalary
    : recurringIncome.filter((group) => group.monthCount >= 4).sort((a, b) => b.mean - a.mean).slice(0, 1)
  const salaryByMonth = new Map()
  const salaryRecordedByMonth = new Map()
  for (const group of salaryGroups) {
    for (const [month, amount] of group.monthlyAmounts) salaryByMonth.set(month, (salaryByMonth.get(month) || 0) + amount)
    for (const [month, amount] of (group.allMonthlyAmounts || group.monthlyAmounts)) salaryRecordedByMonth.set(month, (salaryRecordedByMonth.get(month) || 0) + amount)
  }
  const salaryMonths = [...salaryByMonth.values()]
  const salaryMean = salaryMonths.length ? salaryMonths.reduce((sum, amount) => sum + amount, 0) / salaryMonths.length : null
  const recurringExpenseMean = recurringExpenses.filter((group) => !group.excluded).reduce((sum, group) => sum + group.mean, 0)

  return {
    currency,
    recurringExpenses,
    recurringExpenseMean,
    salaryMonthlyAmounts: salaryByMonth,
    salaryRecordedByMonth,
    salary: salaryMean === null ? null : {
      mean: salaryMean,
      months: salaryMonths.length,
      source: salaryGroups.length === 1 ? salaryGroups[0].source : `${salaryGroups.length} recurring sources`,
      explicitlyLabeled: explicitSalary.length > 0,
    },
  }
}

function RecurringDashboard({ data, onRuleSave }) {
  const [editingKey, setEditingKey] = useState(null)
  const [editingField, setEditingField] = useState('alias')
  const [draftAlias, setDraftAlias] = useState('')
  const [draftAllocations, setDraftAllocations] = useState([])
  const [savingKey, setSavingKey] = useState(null)
  const [ruleError, setRuleError] = useState('')
  const [expenseSort, setExpenseSort] = useState('amount')
  const [outlookMode, setOutlookMode] = useState('average')
  const [selectedOutlookMonth, setSelectedOutlookMonth] = useState(() => currentFinanceMonth())
  const insights = useMemo(() => buildRecurringInsights(data), [data])
  const { currency, recurringExpenses, recurringExpenseMean, salary, salaryRecordedByMonth } = insights
  const monthOptions = recentOutlookMonthOptions()
  const selectedMonth = monthOptions.includes(selectedOutlookMonth) ? selectedOutlookMonth : monthOptions[0]
  const selectedMonthIndex = monthOptions.indexOf(selectedMonth)
  const selectedMonthCaption = `${outlookMonthLabel(selectedMonth)}${selectedMonth === monthOptions[0] ? ' to date' : ''}`
  const monthlySalaryDetected = salaryRecordedByMonth.has(selectedMonth)
  const monthlySalary = monthlySalaryDetected ? salaryRecordedByMonth.get(selectedMonth) : null
  const displayedExpenseAmount = (expense) => outlookMode === 'month' ? monthlyExpenseAmount(expense, selectedMonth) : expense.mean
  const displayedExpenseTotal = outlookMode === 'month'
    ? recurringExpenses.filter((expense) => !expense.excluded).reduce((sum, expense) => sum + monthlyExpenseAmount(expense, selectedMonth), 0)
    : recurringExpenseMean
  const remainder = outlookMode === 'month'
    ? monthlySalaryDetected ? monthlySalary - displayedExpenseTotal : null
    : salary ? salary.mean - recurringExpenseMean : null
  const recurringRules = data?.recurringRules || {}
  const categorySuggestions = useMemo(() => [...new Set([
    ...(data?.transactions || []).map((transaction) => transactionCategory(transaction, data?.categoryOverrides || {})),
    ...Object.values(recurringRules).flatMap((rule) => (rule.categoryAllocations || []).map((allocation) => allocation.category)),
  ].map((category) => String(category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [data, recurringRules])
  const monthHasSpending = (expense) => outlookMode !== 'month' || monthlyExpenseAmount(expense, selectedMonth) > 0
  const activeExpenses = recurringExpenses.filter((expense) => !expense.excluded && monthHasSpending(expense))
  const excludedExpenses = recurringExpenses.filter((expense) => expense.excluded && monthHasSpending(expense))
  const expensesInView = [...activeExpenses, ...excludedExpenses]
  const sortExpenseRows = (expenses) => [...expenses].sort((a, b) => {
    if (expenseSort === 'category') {
      const categoryLabel = (expense) => (expense.categoryAllocations.length ? expense.categoryAllocations : expense.categoryAmounts)
        .map((allocation) => allocation.category)
        .join(' · ') || expense.category
      return categoryLabel(a).localeCompare(categoryLabel(b)) || (b.mean - a.mean)
    }
    return displayedExpenseAmount(b) - displayedExpenseAmount(a)
  })
  const sortedActiveExpenses = sortExpenseRows(activeExpenses)
  const sortedExcludedExpenses = sortExpenseRows(excludedExpenses)
  const persistRule = async (expense, changes) => {
    const current = recurringRules[expense.key] || {}
    const next = {
      alias: changes.alias !== undefined ? changes.alias : current.alias || null,
      category_allocations: changes.categoryAllocations !== undefined ? changes.categoryAllocations : current.categoryAllocations || [],
      excluded: changes.excluded !== undefined ? changes.excluded : Boolean(current.excluded),
    }
    setSavingKey(expense.key)
    setRuleError('')
    try {
      await onRuleSave(expense.key, next)
      setEditingKey(null)
    } catch (error) {
      setRuleError(error.message || 'Could not save this recurring pattern.')
    } finally {
      setSavingKey(null)
    }
  }

  const renderExpense = (expense) => {
    const rule = recurringRules[expense.key] || {}
    const editing = editingKey === expense.key
    const monthAmount = monthlyExpenseAmount(expense, selectedMonth)
    const scaledAllocations = expense.categoryAllocations.length
      ? allocatedCategoryAmounts(expense, monthAmount, expense.category)
      : null
    const monthCategoryAmounts = expense.categoryAmountsByMonth?.get(selectedMonth) || []
    const allocationsToShow = outlookMode === 'month'
      ? scaledAllocations || monthCategoryAmounts
      : expense.categoryAllocations.length ? allocatedCategoryAmounts(expense, expense.mean, expense.category) : expense.categoryAmounts
    const categorySummary = allocationsToShow.map((allocation) => `${allocation.category}: ${money(allocation.amount, currency)}`).join(' · ')
    const transactionCount = expense.allMonthlyCounts?.get(selectedMonth) || 0
    const sourceAccountsToShow = outlookMode === 'month'
      ? expense.sourceAccountsByMonth?.get(selectedMonth) || []
      : expense.sourceAccounts
    const activitySummary = outlookMode === 'month'
      ? `${transactionCount} transaction${transactionCount === 1 ? '' : 's'} in ${selectedMonthCaption}`
      : `seen in ${expense.monthCount} months${expense.transferPattern ? ' · outgoing transfer' : expense.categoryPattern ? ` · ${expense.rows.length} purchases` : ''}`
    const merchantDetails = expense.categoryPattern
      ? expense.merchantDetails.map((merchant) => ({
        ...merchant,
        displayedAmount: outlookMode === 'month' ? Number(merchant.monthlyAmounts.get(selectedMonth) || 0) : merchant.mean,
        displayedCount: outlookMode === 'month' ? Number(merchant.monthlyCounts.get(selectedMonth) || 0) : merchant.count,
        displayedMonths: outlookMode === 'month' ? 0 : merchant.months,
        displayedAccounts: outlookMode === 'month'
          ? [...(merchant.monthlyAccounts.get(selectedMonth) || [])]
          : merchant.accounts,
      })).filter((merchant) => outlookMode !== 'month' || merchant.displayedAmount > 0)
      : []
    const taxFeeDetails = expense.taxFeeDetails?.filter((detail) => outlookMode !== 'month' || Number(detail.monthlyAmounts.get(selectedMonth) || 0) > 0) || []
    return <div key={expense.key} className={`recurring-pattern-row grid min-w-0 grid-cols-[minmax(0,1fr)_44px] gap-x-3 gap-y-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(160px,220px)_44px] sm:items-center ${expense.excluded ? 'opacity-65' : ''}`}>
      <div className="col-span-2 flex min-w-0 items-start gap-3 sm:col-span-1">
        <span className="movement-icon movement-expense"><ArrowDownRight size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="min-w-0 truncate text-xs font-bold" title={expense.alias || expense.source}>{expense.alias || expense.source}</p>{expense.categoryPattern && <span className="rounded-full bg-[#292039] px-2 py-0.5 text-[10px] font-bold text-violet-200">Across merchants</span>}{expense.excluded && <span className="rounded-full bg-[#fafcfb] px-2 py-0.5 text-[10px] font-bold text-muted">Excluded</span>}</div>
          <p className="mt-0.5 truncate text-[10px] text-muted" title={categorySummary}>{categorySummary || expense.category} · {activitySummary}</p>
          {expense.classificationNote && <p className="mt-1 break-words text-[10px] text-muted">{expense.classificationNote}</p>}
          <p className="mt-1 break-words text-[10px] text-muted">Source account{sourceAccountsToShow.length === 1 ? '' : 's'}: {sourceAccountsToShow.join(' · ') || 'No activity this month'}</p>
          {expense.categoryPattern && merchantDetails.length > 0 && <details className="mt-2 max-w-2xl rounded-lg border border-[#2d2537] px-2.5 py-2 text-[10px]">
            <summary className="cursor-pointer font-semibold">Merchant details ({merchantDetails.length})</summary>
            <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">{merchantDetails.map((merchant) => <li key={merchant.source} className="min-w-0">
              <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><span className="break-words">{merchant.source} · {merchant.displayedCount} purchase{merchant.displayedCount === 1 ? '' : 's'}{outlookMode === 'month' ? '' : ` · ${merchant.displayedMonths} months`}</span><span className="shrink-0 font-semibold">{money(merchant.displayedAmount, currency)}{outlookMode === 'month' ? '' : ' / month'}</span></div>
              <p className="mt-0.5 break-words text-muted">Source account{merchant.displayedAccounts.length === 1 ? '' : 's'}: {merchant.displayedAccounts.join(' · ')}</p>
            </li>)}</ul>
          </details>}
          {expense.taxFeePattern && taxFeeDetails.length > 0 && <details className="mt-2 rounded-lg border border-[#2d2537] px-2.5 py-2 text-[10px]">
            <summary className="cursor-pointer font-semibold">Tax and fee details ({taxFeeDetails.length})</summary>
            <ul className="mt-2 space-y-2">{taxFeeDetails.map((detail) => <li key={detail.source} className="min-w-0">
              <div className="flex min-w-0 flex-wrap justify-between gap-x-3"><span className="break-words">{detail.source}</span><span className="shrink-0 font-semibold">{money(outlookMode === 'month' ? Number(detail.monthlyAmounts.get(selectedMonth) || 0) : detail.mean, currency)}{outlookMode === 'month' ? '' : ' / month'}</span></div>
              <p className="mt-0.5 break-words text-muted">Source account{detail.accounts.length === 1 ? '' : 's'}: {detail.accounts.join(' · ')}</p>
            </li>)}</ul>
          </details>}
          {editing && <form className="mt-3 grid min-w-0 gap-2 sm:max-w-[640px]" onSubmit={(event) => {
            event.preventDefault()
            if (editingField === 'alias') void persistRule(expense, { alias: draftAlias.trim() || null })
            else {
              const allocations = draftAllocations
                .map((allocation) => ({ category: allocation.category.trim(), amount: Number(allocation.amount) }))
                .filter((allocation) => allocation.category && Number.isFinite(allocation.amount) && allocation.amount > 0)
              if (allocations.reduce((sum, allocation) => sum + allocation.amount, 0) > expense.mean + 0.005) {
                setRuleError(`Assigned categories exceed the ${money(expense.mean, currency)} monthly average for this expense.`)
                return
              }
              void persistRule(expense, { categoryAllocations: allocations })
            }
          }}>
            {editingField === 'alias' ? <input className="input h-10 min-w-0 flex-1" maxLength={120} value={draftAlias} onChange={(event) => setDraftAlias(event.target.value)} placeholder={expense.source} aria-label="Recurring pattern alias" /> : <>
              <p className="text-[11px] text-muted">Set a monthly amount for each category. These allocations do not change the total recurring expense.</p>
              {draftAllocations.map((allocation, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(115px,160px)_40px] gap-2">
                <input className="input h-10" list="recurring-category-suggestions" maxLength={120} required value={allocation.category} onChange={(event) => setDraftAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} placeholder="Category" aria-label={`Category ${index + 1}`} />
                <input className="input h-10" type="number" min="0.01" step="0.01" required value={allocation.amount} onChange={(event) => setDraftAllocations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} aria-label={`Monthly amount for category ${index + 1}`} />
                <button className="icon-button h-10 w-10" type="button" title="Remove category" aria-label={`Remove category ${index + 1}`} onClick={() => setDraftAllocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
              </div>)}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button className="small-outline" type="button" onClick={() => setDraftAllocations((current) => [...current, { category: '', amount: '' }])}><Plus size={14} /> Add category</button>
                <span className="text-[10px] text-muted">Assigned {money(draftAllocations.reduce((sum, allocation) => sum + (Number(allocation.amount) || 0), 0), currency)} / {money(expense.mean, currency)} monthly average</span>
              </div>
            </>}
            <div className="flex flex-wrap gap-2"><button className="small-outline" type="submit" disabled={savingKey === expense.key}>{editingField === 'alias' ? 'Save name' : 'Save category amounts'}</button><button className="small-outline" type="button" onClick={() => setEditingKey(null)}>Cancel</button></div>
          </form>}
        </div>
      </div>
      <div className="min-w-0 self-center text-left sm:text-right"><p className="text-sm font-extrabold">{money(displayedExpenseAmount(expense), currency)}</p><p className="text-[10px] text-muted">{outlookMode === 'month' ? selectedMonthCaption : 'average / month'}</p></div>
      <details className="recurring-more-menu">
        <summary aria-label={`More actions for ${expense.alias || expense.source}`} title="More actions"><MoreVertical size={20} /></summary>
        <div className="recurring-more-options" role="group" aria-label="Recurring pattern actions">
          <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; if (editing && editingField === 'alias') { setEditingKey(null); return } setRuleError(''); setEditingKey(expense.key); setEditingField('alias'); setDraftAlias(rule.alias || '') }}>{editing && editingField === 'alias' ? 'Close alias editor' : 'Set alias'}</button>
          <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; if (editing && editingField === 'allocations') { setEditingKey(null); return } setRuleError(''); setEditingKey(expense.key); setEditingField('allocations'); setDraftAllocations((expense.categoryAllocations.length ? expense.categoryAllocations : expense.categoryAmounts).map((allocation) => ({ category: allocation.category, amount: Number(allocation.amount).toFixed(2) }))) }}>{editing && editingField === 'allocations' ? 'Close category editor' : 'Set category amounts'}</button>
          <button type="button" disabled={savingKey === expense.key} onClick={(event) => { event.currentTarget.closest('details').open = false; void persistRule(expense, { excluded: !expense.excluded }) }}>{expense.excluded ? 'Restore expense' : 'Exclude expense'}</button>
        </div>
      </details>
    </div>
  }

  return (
    <section className="panel mb-7 w-full min-w-0 rounded-[24px] bg-white p-5 shadow-soft md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Recurring patterns · last 12 months</p>
          <h2 className="section-title mt-1">Monthly outlook</h2>
          <p className="mt-1 text-xs text-muted">{outlookMode === 'month'
            ? `Showing detected posted spending for ${selectedMonthCaption}. Credit card purchases count; card bill payments are excluded to prevent double counting.`
            : 'Recurring charges and outgoing PIX, plus everyday spending grouped across merchants from the last 12 months. Credit card purchases count; card bill payments are excluded to prevent double counting.'}</p>
          <p className="mt-1 text-[10px] text-muted">Weekday restaurant charges recorded from 11 a.m. to 3 p.m. are grouped as workday lunches, across merchants. Delivery is separated by service or transaction wording; other restaurant times appear as eating out.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <div className="inline-flex rounded-xl border border-[#edf1ee] bg-[#fafcfb] p-1" role="group" aria-label="Monthly outlook view">
            <button type="button" className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${outlookMode === 'average' ? 'bg-[#292039] text-white' : 'text-muted'}`} aria-pressed={outlookMode === 'average'} onClick={() => setOutlookMode('average')}>Averages</button>
            <button type="button" className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${outlookMode === 'month' ? 'bg-[#292039] text-white' : 'text-muted'}`} aria-pressed={outlookMode === 'month'} onClick={() => setOutlookMode('month')}>By month</button>
          </div>
          {outlookMode === 'month' && <div className="flex items-center gap-1 rounded-xl border border-[#edf1ee] bg-[#fafcfb] p-1">
            <button type="button" className="icon-button h-9 w-9" aria-label="Previous month" title="Previous month" disabled={selectedMonthIndex >= monthOptions.length - 1} onClick={() => setSelectedOutlookMonth(monthOptions[selectedMonthIndex + 1] || selectedMonth)}><ChevronLeft size={17} /></button>
            <span className="min-w-[118px] text-center text-xs font-bold" aria-live="polite">{outlookMonthLabel(selectedMonth)}</span>
            <button type="button" className="icon-button h-9 w-9" aria-label="Next month" title="Next month" disabled={selectedMonthIndex <= 0} onClick={() => setSelectedOutlookMonth(monthOptions[selectedMonthIndex - 1] || selectedMonth)}><ChevronRight size={17} /></button>
          </div>}
          <span className="rounded-full border border-[#edf1ee] bg-[#fafcfb] px-3 py-2 text-[10px] font-bold text-muted">{currency}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-green"><ArrowUpRight size={16} /></span>{outlookMode === 'month' ? `Detected salary · ${selectedMonthCaption}` : 'Mean monthly salary'}</div>
          <p className="mt-3 font-display text-2xl font-extrabold">{outlookMode === 'month' ? monthlySalaryDetected ? money(monthlySalary, currency) : 'Not detected' : salary ? money(salary.mean, currency) : 'Not detected'}</p>
          <p className="mt-1 truncate text-[10px] text-muted" title={salary?.source || ''}>{outlookMode === 'month' ? monthlySalaryDetected ? `Recognized source: ${salary?.source || 'Recurring deposit'}` : 'No recognized salary deposit in this month' : salary ? `${salary.explicitlyLabeled ? 'Salary' : 'Likely'}: ${salary.source} · ${salary.months} pay months` : 'Need at least 3 regular deposits'}</p>
        </div>
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-rose"><RefreshCw size={15} /></span>{outlookMode === 'month' ? `Detected spending · ${selectedMonthCaption}` : 'Recurring & everyday / month'}</div>
          <p className="mt-3 font-display text-2xl font-extrabold">{money(displayedExpenseTotal, currency)}</p>
          <p className="mt-1 text-[10px] text-muted">{outlookMode === 'month' ? `${activeExpenses.length} active patterns · ${excludedExpenses.length} excluded` : `${recurringExpenses.filter((expense) => !expense.excluded).length} active · ${recurringExpenses.filter((expense) => expense.excluded).length} excluded patterns`}</p>
        </div>
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-violet"><Wallet size={15} /></span>{outlookMode === 'month' ? 'Salary after spending' : 'Salary after detected spending'}</div>
          <p className={`mt-3 font-display text-2xl font-extrabold ${remainder !== null && remainder < 0 ? 'text-rose-600' : ''}`}>{remainder === null ? '—' : money(remainder, currency)}</p>
          <p className="mt-1 text-[10px] text-muted">{outlookMode === 'month' ? monthlySalaryDetected ? `For ${selectedMonthCaption}; detected patterns only` : 'No recognized salary deposit for this month' : 'After recurring bills and regular category spending'}</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-sm font-extrabold">{outlookMode === 'month' ? `Spending in ${selectedMonthCaption}` : 'Recurring and everyday spending'}</h3><p className="mt-1 text-[10px] text-muted">{outlookMode === 'month' ? 'Amounts and category splits show posted transactions for this month only.' : 'Regular patterns need activity in at least 5 months; workday lunches appear after 3 weekday lunch-time purchases across 2 months. Source averages use active months; category averages use the full 12-month window. Choose By month for actual posted totals.'}</p></div>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">Sort by <select className="period-select" aria-label="Sort recurring expenses" value={expenseSort} onChange={(event) => setExpenseSort(event.target.value)}><option value="amount">Monthly amount</option><option value="category">Category</option></select></label>
        </div>
        {expensesInView.length ? <>
          <datalist id="recurring-category-suggestions">{categorySuggestions.map((category) => <option key={category} value={category} />)}</datalist>
          {activeExpenses.length > 0 && <div className="divide-y divide-[#edf1ee]">{sortedActiveExpenses.map(renderExpense)}</div>}
          {excludedExpenses.length > 0 && <details className="mt-4 rounded-xl border border-[#2d2537] bg-[#17131e] p-3">
            <summary className="cursor-pointer text-xs font-bold">Excluded expenses ({excludedExpenses.length})</summary>
            <div className="mt-2 divide-y divide-[#2d2537]">{sortedExcludedExpenses.map(renderExpense)}</div>
          </details>}
        </> : <EmptyState icon={<RefreshCw size={19} />} title={outlookMode === 'month' ? `No detected spending in ${selectedMonthCaption}` : 'No recurring spending patterns detected'} detail={outlookMode === 'month' ? 'Use the month arrows to review another month.' : 'More repeated monthly transactions will make patterns easier to identify.'} />}
        {ruleError && <p className="mt-3 text-xs text-rose-600" role="alert">{ruleError}</p>}
      </div>
      <p className="mt-4 border-t border-[#edf1ee] pt-3 text-[10px] leading-relaxed text-muted">Posted credit card purchases and bank account spending count. Card bill settlements, own-account transfers, bank slips, and investments are excluded to avoid double counting. Everyday categories are grouped across merchants; most require activity in 5 months, while workday lunches appear after 3 weekday lunch-time purchases across 2 months. {outlookMode === 'month' ? 'Monthly view shows activity for the selected month.' : 'Category averages use the 12-month window.'} Workday lunch classification uses the transaction timestamp. Outgoing PIX counts only when the same recipient pattern appears in at least 5 months. Salary is inferred from regular bank deposits unless explicitly labeled.</p>
    </section>
  )
}

function formatCurrencyTotals(totals) {
  const entries = [...totals.entries()].filter(([, amount]) => amount !== 0)
  return entries.length ? entries.map(([currency, amount]) => money(amount, currency)).join(' · ') : 'Not reported'
}

function CreditAndSlipsDashboard({ data }) {
  const accounts = data?.accounts || []
  const displayAliases = data?.displayAliases || {}
  const transactions = data?.transactions || []
  const bills = data?.bills || []
  const creditAccounts = accounts.filter((account) => account.type === 'CREDIT')
  const bankAccountsById = new Map(accounts.map((account) => [String(account.id), account]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setFullYear(cutoff.getFullYear() - 1)

  const balanceTotals = new Map()
  const limitTotals = new Map()
  const availableTotals = new Map()
  const upcomingBillTotals = new Map()
  let upcomingBillAccounts = 0
  const upcomingBillsByAccount = new Map()
  for (const account of creditAccounts) {
    const currency = account.currencyCode || 'BRL'
    const balance = Number(account.balance)
    if (Number.isFinite(balance)) balanceTotals.set(currency, (balanceTotals.get(currency) || 0) + Math.abs(balance))
    const credit = account.creditData || {}
    const limit = Number(credit.creditLimit)
    const available = Number(credit.availableCreditLimit)
    if (credit.creditLimit != null && Number.isFinite(limit)) limitTotals.set(currency, (limitTotals.get(currency) || 0) + limit)
    if (credit.availableCreditLimit != null && Number.isFinite(available)) availableTotals.set(currency, (availableTotals.get(currency) || 0) + available)

    const accountBills = bills
      .filter((bill) => String(bill._accountId) === String(account.id))
      .filter((bill) => bill.dueDate && parseFinanceDate(bill.dueDate) >= today)
      .sort((a, b) => parseFinanceDate(a.dueDate) - parseFinanceDate(b.dueDate))
    const nextBill = accountBills[0]
    if (nextBill) {
      upcomingBillAccounts += 1
      upcomingBillsByAccount.set(String(account.id), nextBill)
      const billCurrency = nextBill.totalAmountCurrencyCode || currency
      const amount = Number(nextBill.totalAmount)
      if (Number.isFinite(amount)) upcomingBillTotals.set(billCurrency, (upcomingBillTotals.get(billCurrency) || 0) + amount)
    }
  }

  const slipCutoff = cutoff.getTime()
  const now = Date.now()
  const slips = transactions.filter((transaction) => {
    const date = parseFinanceDate(transaction.date).getTime()
    return isBankSlipTransaction(transaction)
      && isExpense(transaction)
      && isPosted(transaction)
      && transaction._accountType !== 'CREDIT'
      && date >= slipCutoff
      && date <= now
  }).sort((a, b) => parseFinanceDate(b.date) - parseFinanceDate(a.date))
  const slipTotals = new Map()
  const slipsByAccount = new Map()
  for (const slip of slips) {
    const account = bankAccountsById.get(String(slip.accountId))
    const name = account ? displayAccountName(account, displayAliases) : slip._accountName || 'Bank account'
    const currency = slip.currencyCode || account?.currencyCode || 'BRL'
    const amount = expenseValue(slip)
    slipTotals.set(currency, (slipTotals.get(currency) || 0) + amount)
    const key = `${slip.accountId || name}:${currency}`
    const current = slipsByAccount.get(key) || { name, currency, amount: 0, count: 0 }
    current.amount += amount
    current.count += 1
    slipsByAccount.set(key, current)
  }
  const slipAccountRows = [...slipsByAccount.values()].sort((a, b) => b.amount - a.amount)

  return (
    <section className="panel mb-7 w-full min-w-0 rounded-[24px] bg-white p-5 shadow-soft md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Credit & payment breakdown</p>
          <h2 className="section-title mt-1">Cards and bank slips</h2>
          <p className="mt-1 text-xs text-muted">Limits and reported card balances by account; paid bank slips from the last 12 months.</p>
        </div>
        <span className="rounded-full border border-[#edf1ee] bg-[#fafcfb] px-3 py-1.5 text-[10px] font-bold text-muted">{creditAccounts.length} credit card{creditAccounts.length === 1 ? '' : 's'}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-rose"><CreditCard size={15} /></span>Total card balances</div>
          <p className="mt-3 font-display text-xl font-extrabold">{formatCurrencyTotals(balanceTotals)}</p>
          <p className="mt-1 text-[10px] text-muted">Reported balance across credit accounts</p>
        </div>
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-violet"><CreditCard size={15} /></span>Total credit limit</div>
          <p className="mt-3 font-display text-xl font-extrabold">{formatCurrencyTotals(limitTotals)}</p>
          <p className="mt-1 text-[10px] text-muted">Sum of limits reported by Pluggy</p>
        </div>
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-green"><Wallet size={15} /></span>Available credit</div>
          <p className="mt-3 font-display text-xl font-extrabold">{formatCurrencyTotals(availableTotals)}</p>
          <p className="mt-1 text-[10px] text-muted">Remaining limits reported by Pluggy</p>
        </div>
        <div className="rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted"><span className="stat-icon stat-blue"><ArrowDownRight size={15} /></span>Upcoming invoices</div>
          <p className="mt-3 font-display text-xl font-extrabold">{formatCurrencyTotals(upcomingBillTotals)}</p>
          <p className="mt-1 text-[10px] text-muted">Reported for {upcomingBillAccounts} of {creditAccounts.length} cards</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-[#edf1ee] p-4">
          <div className="mb-3 flex items-center gap-2"><span className="stat-icon stat-violet"><CreditCard size={15} /></span><div><h3 className="text-sm font-extrabold">Credit account limits</h3><p className="mt-0.5 text-[10px] text-muted">Current balance, total limit, remaining limit, and next invoice.</p></div></div>
          {creditAccounts.length ? <div className="divide-y divide-[#edf1ee]">
            {creditAccounts.map((account) => {
              const currency = account.currencyCode || 'BRL'
              const credit = account.creditData || {}
              const nextBill = upcomingBillsByAccount.get(String(account.id))
              const limit = credit.creditLimit == null ? null : Number(credit.creditLimit)
              const available = credit.availableCreditLimit == null ? null : Number(credit.availableCreditLimit)
              return <div key={account.id} className="py-3 first:pt-1 last:pb-1">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold">{displayAccountName(account, displayAliases)}</p><p className="mt-0.5 truncate text-[10px] text-muted">{displayInstitutionForAccount(account, displayAliases)}{account.number ? ` · ${account.number}` : ''}</p></div><p className="shrink-0 text-xs font-extrabold">{money(Math.abs(Number(account.balance || 0)), currency)}</p></div>
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 text-[10px] sm:grid-cols-3"><div className="min-w-0"><p className="text-muted">Total limit</p><p className="mt-0.5 font-bold">{limit == null || !Number.isFinite(limit) ? 'Not reported' : money(limit, currency)}</p></div><div className="min-w-0"><p className="text-muted">Available</p><p className="mt-0.5 font-bold">{available == null || !Number.isFinite(available) ? 'Not reported' : money(available, currency)}</p></div><div className="min-w-0"><p className="text-muted">Next invoice</p><p className="mt-0.5 font-bold">{nextBill ? money(nextBill.totalAmount, nextBill.totalAmountCurrencyCode || currency) : 'Not reported'}</p><p className="text-muted">{nextBill ? `Due ${dateLabel(nextBill.dueDate, { month: 'short', day: 'numeric' })}` : 'No upcoming invoice'}</p></div></div>
              </div>
            })}
          </div> : <EmptyState icon={<CreditCard size={19} />} title="No credit accounts" detail="Credit limits and invoices will appear here when available from Pluggy." />}
        </div>

        <div className="rounded-2xl border border-[#edf1ee] p-4">
          <div className="mb-3 flex items-center gap-2"><span className="stat-icon stat-blue"><Landmark size={15} /></span><div><h3 className="text-sm font-extrabold">Bank slips paid</h3><p className="mt-0.5 text-[10px] text-muted">Last 12 months · {formatCurrencyTotals(slipTotals)} · {slips.length} transactions</p></div></div>
          {slipAccountRows.length ? <div className="mb-3 divide-y divide-[#edf1ee]">
            {slipAccountRows.map((row) => <div key={`${row.name}:${row.currency}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 text-xs"><div className="min-w-0"><p className="truncate font-bold">{row.name}</p><p className="mt-0.5 text-[10px] text-muted">{row.count} bank slip{row.count === 1 ? '' : 's'}</p></div><p className="shrink-0 font-extrabold">{money(row.amount, row.currency)}</p></div>)}
          </div> : <p className="py-2 text-xs text-muted">No paid bank slips reported in the last 12 months.</p>}
          {slips.length > 0 && <details className="border-t border-[#edf1ee] pt-2 text-[10px] text-muted">
            <summary className="cursor-pointer font-semibold">Recent bank slips</summary>
            <div className="mt-2 space-y-2">{slips.slice(0, 6).map((slip) => { const account = bankAccountsById.get(String(slip.accountId)); return <div key={slip.id} className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-ink">{slip.description || slip.descriptionRaw || 'Bank slip'}</p><p className="mt-0.5 truncate">{dateLabel(slip.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {account ? displayAccountName(account, displayAliases) : slip._accountName || 'Bank account'}</p></div><p className="shrink-0 font-bold text-ink">{money(expenseValue(slip), slip.currencyCode || 'BRL')}</p></div>})}</div>
          </details>}
        </div>
      </div>
      <p className="mt-4 border-t border-[#edf1ee] pt-3 text-[10px] leading-relaxed text-muted">Card balances and limits use the latest account snapshot Pluggy provides. Upcoming invoice totals include only invoices with a due date today or later; banks may report this data for only some cards. Bank slips include posted bank-account debits tagged as bank slips.</p>
    </section>
  )
}

function installmentDestination(value, totalInstallments) {
  const destination = String(value || 'Unknown destination').trim()
  const fraction = destination.match(/(?:PARC(?:ELA)?[ .:_-]*)?(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/i)
  const hasInstallmentOrdinal = Boolean(fraction && Number(fraction[2]) === Number(totalInstallments))
  const label = hasInstallmentOrdinal
    ? destination.replace(/(?:PARC(?:ELA)?[ .:_-]*)?\d{1,2}\s*\/\s*\d{1,2}(?!\d)/ig, ' ').replace(/\s+/g, ' ').trim()
    : destination
  return { label: label || destination, hasInstallmentOrdinal }
}

function installmentOrdinalPresent(values, totalInstallments) {
  return values.some((value) => {
    const fraction = String(value || '').match(/(?:PARC(?:ELA)?[ .:_-]*)?(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/i)
    return Boolean(fraction && Number(fraction[2]) === Number(totalInstallments))
  })
}

function installmentSourcesMatch(left, right) {
  const leftNormalized = normalizeRecurringSource(left)
  const rightNormalized = normalizeRecurringSource(right)
  if (leftNormalized === rightNormalized) return true
  if (Math.min(leftNormalized.length, rightNormalized.length) >= 5
    && (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized))) return true

  const leftTokens = leftNormalized.split(' ').filter(Boolean)
  const rightTokens = rightNormalized.split(' ').filter(Boolean)
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens
  const longer = shorter === leftTokens ? rightTokens : leftTokens
  if (shorter.length < 3) return false
  return shorter.every((token, index) => {
    const candidate = longer[index] || ''
    return token === candidate || (Math.min(token.length, candidate.length) >= 3 && (token.startsWith(candidate) || candidate.startsWith(token)))
  })
}

function installmentMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/)
  if (!match) return ''
  const month = Number(match[2])
  if (month < 1 || month > 12) return ''
  return `${match[1]}-${match[2]}`
}

function shiftInstallmentMonth(value, offset) {
  const month = installmentMonth(value)
  if (!month) return ''
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(year, monthNumber - 1 + offset, 1)
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`
}

function installmentMonthLabel(value) {
  const month = installmentMonth(value)
  if (!month) return 'Not reported'
  const [year, monthNumber] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1))
}

function currentFinanceMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return year && month ? `${year}-${month}` : ''
}

function shiftOutlookMonth(value, offset) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return ''
  const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1))
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`
}

function outlookMonthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return 'Current month'
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
}

function recentOutlookMonthOptions() {
  const current = currentFinanceMonth() || new Date().toISOString().slice(0, 7)
  return Array.from({ length: 12 }, (_, index) => shiftOutlookMonth(current, -index))
}

function monthlyExpenseAmount(expense, month) {
  const amounts = expense.allMonthlyAmounts || expense.monthlyAmounts
  return Number(amounts?.get(month) || 0)
}

function allocatedCategoryAmounts(expense, amount, fallbackCategory) {
  const allocations = (expense.categoryAllocations || []).filter((row) => row.category && Number(row.amount) > 0)
  if (!allocations.length || !Number.isFinite(expense.mean) || expense.mean <= 0) return [{ category: fallbackCategory, amount }]
  const requested = allocations.reduce((sum, row) => sum + Number(row.amount), 0)
  const assigned = amount * Math.min(1, requested / expense.mean)
  const totals = new Map()
  for (const row of allocations) {
    totals.set(row.category, (totals.get(row.category) || 0) + assigned * Number(row.amount) / requested)
  }
  if (amount - assigned > 0.005) totals.set(fallbackCategory, (totals.get(fallbackCategory) || 0) + amount - assigned)
  return [...totals].map(([category, value]) => ({ category, amount: value }))
}

function buildInstallmentPlans(data) {
  const displayAliases = data?.displayAliases || {}
  const accountsById = new Map((data?.accounts || []).map((account) => [String(account.id), account]))
  const grouped = new Map()
  for (const transaction of data?.transactions || []) {
    const metadata = transaction.creditCardMetadata
    const totalInstallments = Number(metadata?.totalInstallments)
    const installmentNumber = Number(metadata?.installmentNumber)
    const amount = Number(transaction.amount)
    const account = accountsById.get(String(transaction.accountId))
    if (!metadata || account?.type !== 'CREDIT' || !Number.isInteger(totalInstallments) || totalInstallments < 2
      || !Number.isInteger(installmentNumber) || installmentNumber < 1 || amount <= 0
      || !['POSTED', 'PENDING', undefined, null].includes(transaction.status)) continue

    const merchant = transaction.merchant
    const rawDestination = (typeof merchant === 'string' ? merchant : merchant?.name || merchant?.businessName || merchant?.displayName)
      || transaction.descriptionRaw || transaction.description || 'Unknown destination'
    const { label: destination } = installmentDestination(rawDestination, totalInstallments)
    const hasInstallmentOrdinal = installmentOrdinalPresent(
      [rawDestination, transaction.descriptionRaw, transaction.description],
      totalInstallments,
    )
    const purchaseDate = metadata.purchaseDate || transaction.date || ''
    const purchaseDay = String(purchaseDate).slice(0, 10)
    const cardNumber = String(metadata.cardNumber || account.number || '')
    // Some institutions append "02/04", "03/04", etc. to the same purchase
    // description. Those rows describe installments of one plan, so group them
    // by purchase day. Keep the timestamp for descriptions without that marker
    // because multiple same-merchant purchases can happen on the same day.
    const purchaseKey = hasInstallmentOrdinal ? purchaseDay : purchaseDate
    const reportedTotal = Number(metadata.totalAmount)
    const sourceKey = normalizeRecurringSource(destination)
    const groupBaseKey = [account.id, cardNumber, purchaseKey, totalInstallments].join('|')
    const compatibleGroups = [...grouped.values()].filter((candidate) => {
      if (candidate.groupBaseKey !== groupBaseKey
        || ![...candidate.sourceKeys].some((candidateSource) => installmentSourcesMatch(candidateSource, destination))) return false
      if (Number.isFinite(reportedTotal) && reportedTotal > 0 && candidate.reportedTotal) {
        const totalTolerance = Math.max(0.05, candidate.reportedTotal * 0.001)
        if (Math.abs(Math.abs(reportedTotal) - candidate.reportedTotal) > totalTolerance) return false
      }
      const existing = candidate.installments.get(installmentNumber)
      if (existing) return Math.abs(existing.amount - Math.abs(amount)) <= 0.01
      const amounts = [...candidate.installments.values()].map((row) => row.amount).sort((a, b) => a - b)
      const middle = Math.floor(amounts.length / 2)
      const typicalAmount = amounts.length % 2
        ? amounts[middle]
        : (amounts[middle - 1] + amounts[middle]) / 2
      const amountTolerance = Math.max(0.05, typicalAmount * 0.005)
      return Math.abs(Math.abs(amount) - typicalAmount) <= amountTolerance
    })
    // A purchase can report a slightly different first installment than later
    // ones. Merge matching rows by card, purchase day, term, and source when
    // the installment numbers do not conflict and amounts remain close.
    let group = compatibleGroups.length === 1 ? compatibleGroups[0] : null
    if (!group) {
      const keyRoot = `${groupBaseKey}|${sourceKey}`
      let key = keyRoot
      let suffix = 2
      while (grouped.has(key)) key = `${keyRoot}|${suffix++}`
      group = {
      key,
      groupBaseKey,
      accountId: String(account.id),
      destination,
      purchaseDate: purchaseDay || purchaseDate,
      totalInstallments,
      currency: transaction.currencyCode || account.currencyCode || 'BRL',
      accountName: displayAccountName(account, displayAliases),
      institutionName: displayInstitutionForAccount(account, displayAliases),
      cardNumber,
      installments: new Map(),
      reportedTotal: null,
      sourceKeys: new Set(),
      billIds: new Set(),
      }
      group.sourceKeys.add(sourceKey)
      grouped.set(group.key, group)
    } else {
      group.sourceKeys.add(sourceKey)
      const currentLabelTokens = normalizeRecurringSource(group.destination).split(' ').filter(Boolean)
      const nextLabelTokens = sourceKey.split(' ').filter(Boolean)
      if (nextLabelTokens.length < currentLabelTokens.length) group.destination = destination
    }
    if (metadata.billId) group.billIds.add(String(metadata.billId))
    if (Number.isFinite(reportedTotal) && reportedTotal > 0) group.reportedTotal = Math.abs(reportedTotal)
    const current = group.installments.get(installmentNumber)
    const reportedDueMonth = installmentMonth(metadata.billPostDate) || installmentMonth(metadata.billForecastDate)
    const row = {
      number: installmentNumber,
      amount: Math.abs(amount),
      status: transaction.status || 'POSTED',
      dueMonth: reportedDueMonth,
      transactionDate: transaction.date || '',
    }
    if (!current || (current.status !== 'POSTED' && row.status === 'POSTED')) group.installments.set(installmentNumber, row)
  }

  const plans = [...grouped.values()].map((group) => {
    const installmentRows = [...group.installments.values()].sort((a, b) => a.number - b.number)
    const latest = installmentRows.at(-1)
    const installmentAmounts = installmentRows.map((row) => row.amount).sort((a, b) => a - b)
    const middle = Math.floor(installmentAmounts.length / 2)
    const typicalInstallmentValue = installmentAmounts.length % 2
      ? installmentAmounts[middle]
      : ((installmentAmounts[middle - 1] || 0) + (installmentAmounts[middle] || 0)) / 2
    const installmentValue = latest?.amount || typicalInstallmentValue || 0
    const observedInstallmentTotal = installmentRows.reduce((sum, row) => sum + row.amount, 0)
    const missingInstallments = Math.max(0, group.totalInstallments - installmentRows.length)
    const totalValue = group.reportedTotal || observedInstallmentTotal + missingInstallments * typicalInstallmentValue
    const postedRows = installmentRows.filter((row) => row.status === 'POSTED')
    const highestPostedNumber = Math.max(0, ...postedRows.map((row) => row.number))
    const reportedPaidInstallments = Math.min(group.totalInstallments, Math.max(
      highestPostedNumber,
      latest?.status === 'PENDING' ? latest.number - 1 : latest?.number || 0,
    ))
    const dueMonthAnchor = installmentRows.find((row) => row.dueMonth)
    const currentMonth = currentFinanceMonth()
    const scheduleRows = Array.from({ length: group.totalInstallments }, (_, index) => {
      const number = index + 1
      const observed = group.installments.get(number)
      const estimatedMonth = !observed?.dueMonth && dueMonthAnchor
        ? shiftInstallmentMonth(dueMonthAnchor.dueMonth, number - dueMonthAnchor.number)
        : ''
      const dueMonth = observed?.dueMonth || estimatedMonth
      return {
        number,
        amount: observed?.amount || installmentValue,
        dueMonth,
        estimatedMonth: Boolean(!observed?.dueMonth && estimatedMonth),
        observedStatus: observed?.status || '',
        pastBillMonth: Boolean(currentMonth && dueMonth && dueMonth < currentMonth),
      }
    })
    // Card history may contain the first posted installment but omit older
    // invoice cycles. The user confirmed those past bills were paid, so count
    // installments with due months before this month as paid in the summary.
    const pastBillPaidCount = scheduleRows.filter((row) => row.pastBillMonth).length
    const paidInstallments = Math.max(reportedPaidInstallments, pastBillPaidCount)
    const observedPaidValue = postedRows.reduce((sum, row) => sum + row.amount, 0)
    const inferredMissingPaid = Math.max(0, paidInstallments - postedRows.length)
    const paidValue = Math.min(totalValue, observedPaidValue + inferredMissingPaid * typicalInstallmentValue)
    const totalEstimated = !group.reportedTotal
    const paidEstimated = inferredMissingPaid > 0
    const completedScheduleRows = scheduleRows.map((row) => ({
      ...row,
      status: row.pastBillMonth
        ? 'Paid · past bill'
        : row.observedStatus === 'PENDING'
          ? 'Pending'
          : row.observedStatus === 'POSTED' || row.number <= reportedPaidInstallments
            ? (row.observedStatus === 'POSTED' ? 'Paid' : 'Paid · estimated')
            : 'Not in available history',
    }))
    return {
      ...group,
      totalValue,
      installmentValue,
      paidValue,
      paidInstallments,
      totalEstimated,
      paidEstimated,
      scheduleRows: completedScheduleRows,
      complete: paidInstallments >= group.totalInstallments || paidValue >= totalValue - 0.01,
      refunded: false,
      refundedAmount: 0,
      refundTransactions: [],
    }
  })

  const refunds = (data?.transactions || []).filter((transaction) => {
    const account = accountsById.get(String(transaction.accountId))
    const label = `${transaction.operationType || ''} ${transaction.descriptionRaw || ''} ${transaction.description || ''} ${transaction.category || ''}`
    return account?.type === 'CREDIT' && Number(transaction.amount) < 0 && isPosted(transaction)
      && /estorno|devolu[cç][aã]o|refund|reversal|chargeback/i.test(label)
  })
  const refundReview = []
  const refundsByPlan = new Map()
  for (const refund of refunds) {
    const refundAccountId = String(refund.accountId)
    const refundSource = normalizeRecurringSource(similarExpenseSource(refund))
    const refundCardNumber = String(refund.creditCardMetadata?.cardNumber || '')
    const refundBillId = String(refund.creditCardMetadata?.billId || '')
    const refundDate = parseFinanceDate(refund.date)
    const refundAmount = expenseValue(refund)
    const candidates = plans.filter((plan) => {
      if (plan.accountId !== refundAccountId) return false
      if (refundCardNumber && plan.cardNumber && refundCardNumber !== plan.cardNumber) return false
      if (!installmentSourcesMatch(refundSource, plan.destination)) return false
      const purchaseDate = parseFinanceDate(plan.purchaseDate)
      if (!Number.isNaN(purchaseDate.getTime()) && !Number.isNaN(refundDate.getTime())) {
        const ageDays = (refundDate.getTime() - purchaseDate.getTime()) / 86_400_000
        if (ageDays < -1 || ageDays > 365) return false
      }
      const totalTolerance = Math.max(2, plan.totalValue * 0.02)
      const installmentTolerance = Math.max(2, plan.installmentValue * 0.02)
      return Math.abs(refundAmount - plan.totalValue) <= totalTolerance
        || Math.abs(refundAmount - plan.installmentValue) <= installmentTolerance
    })
    const billReferenceCandidates = candidates.length ? [] : plans.filter((plan) => {
      if (plan.accountId !== refundAccountId || !refundBillId || !plan.billIds.has(refundBillId)) return false
      if (refundCardNumber && plan.cardNumber && refundCardNumber !== plan.cardNumber) return false
      const purchaseDate = parseFinanceDate(plan.purchaseDate)
      if (!Number.isNaN(purchaseDate.getTime()) && !Number.isNaN(refundDate.getTime())) {
        const ageDays = (refundDate.getTime() - purchaseDate.getTime()) / 86_400_000
        if (ageDays < -1 || ageDays > 90) return false
      }
      const totalTolerance = Math.max(0.02, plan.totalValue * 0.001)
      return Math.abs(refundAmount - plan.totalValue) <= totalTolerance
    })
    const matches = candidates.length ? candidates : billReferenceCandidates
    if (matches.length === 1) {
      const matchedPlan = matches[0]
      const list = refundsByPlan.get(matchedPlan.key) || []
      list.push(refund)
      refundsByPlan.set(matchedPlan.key, list)
    } else if (matches.length > 1) {
      const account = accountsById.get(refundAccountId)
      refundReview.push({
        id: refund.id,
        destination: similarExpenseSource(refund),
        date: refund.date,
        amount: refundAmount,
        currency: refund.currencyCode || account?.currencyCode || 'BRL',
        card: `${account ? displayAccountName(account, displayAliases) : 'Credit card'} · ${account ? displayInstitutionForAccount(account, displayAliases) : 'Connected institution'}`,
        candidates: matches,
      })
    }
  }

  const linkedPlans = plans.map((plan) => {
    const refundTransactions = refundsByPlan.get(plan.key) || []
    const refundedAmount = refundTransactions.reduce((sum, transaction) => sum + expenseValue(transaction), 0)
    const tolerance = Math.max(2, plan.totalValue * 0.02)
    const refunded = refundedAmount >= plan.totalValue - tolerance
    return { ...plan, refundTransactions, refundedAmount, refunded, complete: plan.complete || refunded }
  }).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || a.destination.localeCompare(b.destination))
  return { plans: linkedPlans, refundReview }
}

function InstallmentBillsDashboard({ data }) {
  const { plans, refundReview } = useMemo(() => buildInstallmentPlans(data), [data])
  const unfinished = plans.filter((plan) => !plan.complete && !plan.refunded)
  const finished = plans.filter((plan) => plan.complete && !plan.refunded)
  const refundedPlans = plans.filter((plan) => plan.refunded)
  const renderPlan = (plan) => {
    const progress = plan.totalInstallments ? Math.min(100, plan.paidInstallments / plan.totalInstallments * 100) : 0
    const cardNumberLabel = plan.cardNumber ? ` · •••• ${plan.cardNumber.replace(/\D/g, '').slice(-4) || plan.cardNumber.slice(-4)}` : ''
    return <article key={plan.key} className="min-w-0 rounded-2xl border border-[#edf1ee] bg-[#fafcfb] p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-extrabold"><span className="text-muted">Destination: </span>{plan.destination}</p>
          <p className="mt-1 break-words text-xs text-muted">Card: {plan.accountName} · {plan.institutionName}{cardNumberLabel}</p>
          <p className="mt-1 text-[10px] text-muted">Purchase date: {dateLabel(plan.purchaseDate, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${plan.refunded ? 'bg-[#352125] text-[#f18a82]' : plan.complete ? 'bg-[#183325] text-[#64d99d]' : 'bg-[#28243e] text-[#b6a5ff]'}`}>
          {plan.refunded ? 'Refunded' : `${plan.paidInstallments}/${plan.totalInstallments} installments paid`}
        </span>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total purchase</p><p className="mt-1 break-words text-sm font-extrabold">{money(plan.totalValue, plan.currency)}{plan.totalEstimated && <span className="ml-1 text-[10px] font-medium text-muted">estimated</span>}</p></div>
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{plan.refundTransactions.length ? 'Installments paid' : 'Paid so far'}{plan.paidEstimated ? ' · estimated' : ''}</p><p className="mt-1 break-words text-sm font-extrabold">{money(plan.paidValue, plan.currency)}</p></div>
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Installment value</p><p className="mt-1 break-words text-sm font-extrabold">{money(plan.installmentValue, plan.currency)}</p></div>
        {plan.refundedAmount > 0 && <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Refund received</p><p className="mt-1 break-words text-sm font-extrabold">{money(plan.refundedAmount, plan.currency)}</p><p className="mt-0.5 text-[10px] text-muted">{plan.refundTransactions.map((refund) => dateLabel(refund.date, { month: 'short', day: 'numeric', year: 'numeric' })).join(' · ')}</p></div>}
      </div>
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-[#342b43]" role="progressbar" aria-label={`Installment progress for ${plan.destination}`} aria-valuemin={0} aria-valuemax={plan.totalInstallments} aria-valuenow={plan.paidInstallments}>
          <div className="h-full rounded-full bg-[#a78bfa]" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <details className="mt-4 border-t border-[#342b43] pt-3">
        <summary className="cursor-pointer text-xs font-bold text-muted">Installment schedule ({plan.totalInstallments})</summary>
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {plan.scheduleRows.map((row) => <div key={row.number} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-[#17131f] px-3 py-2 text-[10px]">
            <span className="shrink-0 font-semibold">{row.number}/{plan.totalInstallments}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{row.dueMonth ? `${row.estimatedMonth ? 'Est. ' : ''}${installmentMonthLabel(row.dueMonth)}` : 'Due month not reported'}</span>
            <span className="shrink-0 text-right"><span className="font-bold text-ink">{money(row.amount, plan.currency)}</span><span className="ml-2 text-muted">{row.status}</span></span>
          </div>)}
        </div>
      </details>
    </article>
  }

  return <section className="panel mb-7 w-full min-w-0 rounded-[24px] bg-white p-5 shadow-soft md:p-6">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Credit card purchases</p><h2 className="section-title mt-1">Installment plans</h2><p className="mt-1 text-xs text-muted">Unfinished purchases stay open here; fully paid plans are tucked below.</p></div>
      <span className="rounded-full border border-[#edf1ee] bg-[#fafcfb] px-3 py-1.5 text-[10px] font-bold text-muted">{unfinished.length} unfinished</span>
    </div>
    <p className="mb-4 text-[10px] leading-relaxed text-muted">Some banks omit the original purchase total, so that value is estimated from the installment amount and count. When older card rows are missing, installments due before this month are counted as paid; estimated due months are marked in the schedule.</p>
    {unfinished.length ? <div className="grid min-w-0 gap-3 md:grid-cols-2">{unfinished.map(renderPlan)}</div> : <EmptyState icon={<CreditCard size={19} />} title="No unfinished installment plans" detail={plans.length ? 'All reported plans are paid or refunded.' : 'Installment purchases will appear here when the connected card reports installment details.'} />}
    {refundReview.length > 0 && <div className="mt-4 rounded-xl border border-[#57482c] bg-[#332b1c] p-3">
      <h3 className="text-xs font-extrabold">Refunds needing a match</h3>
      <p className="mt-1 text-[10px] text-muted">These refunds match more than one purchase, so none is marked refunded automatically.</p>
      <div className="mt-2 grid gap-2">{refundReview.map((refund) => <div key={refund.id} className="rounded-lg border border-[#57482c] p-3 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><span className="break-words font-bold">{refund.destination}</span><span className="font-extrabold">{money(refund.amount, refund.currency)}</span></div>
        <p className="mt-1 text-[10px] text-muted">{dateLabel(refund.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {refund.card}</p>
        <p className="mt-1 break-words text-[10px] text-muted">Could match: {refund.candidates.map((plan) => `${plan.destination} (${dateLabel(plan.purchaseDate, { month: 'short', day: 'numeric' })})`).join(' · ')}</p>
      </div>)}</div>
    </div>}
    {finished.length > 0 && <details className="mt-4 rounded-xl border border-[#edf1ee] bg-[#fafcfb] p-3">
      <summary className="cursor-pointer text-xs font-bold">Fully paid installment plans ({finished.length})</summary>
      <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">{finished.map(renderPlan)}</div>
    </details>}
    {refundedPlans.length > 0 && <details className="mt-4 rounded-xl border border-[#edf1ee] bg-[#fafcfb] p-3">
      <summary className="cursor-pointer text-xs font-bold">Refunded installment plans ({refundedPlans.length})</summary>
      <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">{refundedPlans.map(renderPlan)}</div>
    </details>}
  </section>
}

function ExpenseChart({ data, days, setDays, currency, setCurrency }) {
  const overrides = data?.categoryOverrides || {}
  const displayAliases = data?.displayAliases || {}
  const currencies = [...new Set((data?.accounts || []).map((account) => account.currencyCode).filter(Boolean))]
  if (!currencies.length) currencies.push('BRL')
  const activeCurrency = currencies.includes(currency) ? currency : currencies.includes('BRL') ? 'BRL' : currencies[0]
  const chartData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const totals = new Map()
    const contributions = new Map()
    const patternByTransaction = new Map()
    for (const pattern of buildRecurringInsights(data, activeCurrency).recurringExpenses) {
      if (!pattern.categoryAllocations?.length) continue
      for (const transaction of pattern.rows) patternByTransaction.set(String(transaction.id), pattern)
    }
    for (const tx of data?.transactions || []) {
      if (!isExpense(tx) || isInternalTransfer(tx, overrides) || !isPosted(tx) || parseFinanceDate(tx.date) < cutoff || (tx.currencyCode || 'BRL') !== activeCurrency) continue
      const amount = expenseValue(tx)
      const category = transactionCategory(tx, overrides)
      const pattern = patternByTransaction.get(String(tx.id))
      const categoryAmounts = pattern ? allocatedCategoryAmounts(pattern, amount, category) : [{ category, amount }]
      for (const row of categoryAmounts) {
        totals.set(row.category, (totals.get(row.category) || 0) + row.amount)
        if (!contributions.has(row.category)) contributions.set(row.category, [])
        contributions.get(row.category).push({ transaction: tx, amount: row.amount })
      }
    }
    return [...totals.entries()].map(([category, amount]) => ({
      category,
      amount,
      contributions: contributions.get(category).sort((a, b) => b.amount - a.amount),
    })).sort((a, b) => b.amount - a.amount).slice(0, 7)
  }, [data, days, overrides, activeCurrency])
  return (
    <div className="panel w-full min-w-0 rounded-[24px] bg-white p-5 shadow-soft md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><p className="eyebrow">Spending breakdown</p><h2 className="section-title mt-1">Expenses by category</h2></div>
        <div className="flex gap-2"><select className="period-select" value={activeCurrency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select><select className="period-select" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select></div>
      </div>
      {chartData.length ? <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 14, left: 4, bottom: 0 }} barCategoryGap={12}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value) => money(value, activeCurrency, true)} />
            <YAxis type="category" dataKey="category" width={112} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
            <Tooltip cursor={{ fill: 'var(--chart-cursor)' }} formatter={(value) => [money(value, activeCurrency), 'Expenses']} contentStyle={{ borderRadius: 12, border: '1px solid var(--line)', background: 'var(--chart-tooltip)', color: 'var(--ink)', boxShadow: 'var(--shadow-soft)', fontSize: 12 }} />
            <Bar dataKey="amount" fill="var(--accent)" radius={[0, 8, 8, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div> : <EmptyState icon={<ArrowDownLeft size={20} />} title="No expenses in this period" detail="When Pluggy syncs transactions, your spending categories will appear here." />}
      {chartData.length > 0 && <details className="mt-4 rounded-xl border border-[#2d2537] p-3">
        <summary className="cursor-pointer text-xs font-bold">See transactions behind these totals</summary>
        <div className="mt-3 space-y-2">{chartData.map((row) => <details key={row.category} className="rounded-lg border border-[#2d2537] p-3">
          <summary className="cursor-pointer text-xs font-semibold">{row.category} · {money(row.amount, activeCurrency)} · {row.contributions.length} transaction{row.contributions.length === 1 ? '' : 's'}</summary>
          <div className="mt-2 max-h-64 divide-y divide-[#2d2537] overflow-y-auto">{row.contributions.map(({ transaction, amount }) => <div key={transaction.id} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 py-2 text-xs">
            <div className="min-w-0"><p className="break-words font-semibold">{transaction.description || transaction.descriptionRaw || 'Transaction'}</p><p className="mt-0.5 break-words text-[10px] text-muted">{dateLabel(transaction.date, { month: 'short', day: 'numeric', year: 'numeric' })} · {transactionAccountLabel(transaction, displayAliases)}{Math.abs(amount - expenseValue(transaction)) > 0.01 ? ' · allocated share' : ''}</p></div>
            <span className="shrink-0 font-bold">{money(amount, activeCurrency)}</span>
          </div>)}</div>
        </details>)}</div>
      </details>}
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted"><span className="h-2 w-2 rounded-full bg-accent" /> Posted spending excluding own transfers and card payments · {activeCurrency}</div>
    </div>
  )
}

function DisplayAliasEditor({ aliasKey, alias, label, originalName, onSave }) {
  const [draft, setDraft] = useState(alias || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setDraft(alias || ''), [alias, aliasKey])

  const save = async (nextAlias) => {
    setSaving(true)
    setError('')
    try {
      await onSave(aliasKey, nextAlias)
      setDraft(nextAlias || '')
    } catch (saveError) {
      setError(saveError.message || 'Could not save this display alias.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="grid min-w-0 gap-1.5 rounded-xl border border-[#2d2537] bg-[#17131f] p-2.5 sm:grid-cols-[minmax(130px,0.8fr)_minmax(160px,1.2fr)] sm:items-center" onSubmit={(event) => { event.preventDefault(); void save(draft.trim() || null) }}>
    <label className="min-w-0 text-[10px] font-semibold text-muted" title={originalName}><span>{label}</span><span className="block truncate font-normal">{originalName}</span></label>
    <div className="flex min-w-0 gap-1.5">
      <input className="input h-9 min-w-0 flex-1 text-xs" maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={originalName} aria-label={`${label} display alias; original name is ${originalName}`} />
      <button className="icon-button h-9 w-9 shrink-0" type="submit" title="Save alias" aria-label={`Save ${label.toLowerCase()} alias`} disabled={saving}><Check size={15} /></button>
      {alias && <button className="icon-button h-9 w-9 shrink-0" type="button" title="Use original name" aria-label={`Clear ${label.toLowerCase()} alias`} disabled={saving} onClick={() => void save(null)}><X size={15} /></button>}
    </div>
    {error && <p className="text-[10px] text-rose-400 sm:col-span-2" role="alert">{error}</p>}
  </form>
}

function AccountsPanel({ data, onConnect, connecting, onImportExisting, onImportItemId, importing, onAliasSave }) {
  const [showItemId, setShowItemId] = useState(false)
  const [itemIdDraft, setItemIdDraft] = useState('')
  const accounts = data?.accounts || []
  const bills = data?.bills || []
  const items = data?.items || []
  const displayAliases = data?.displayAliases || {}
  const itemById = Object.fromEntries(items.map((item) => [item.id, item]))
  const accountGroups = new Map()
  for (const account of accounts) {
    const itemId = String(account.itemId || '')
    if (!accountGroups.has(itemId)) accountGroups.set(itemId, [])
    accountGroups.get(itemId).push(account)
  }
  const knownInstitutionGroups = items.map((item) => {
    const itemId = String(item.id)
    const itemAccounts = accountGroups.get(itemId) || []
    const institutionName = item.connector?.name || itemAccounts[0]?._institutionName || itemAccounts[0]?._itemName || 'Connected institution'
    return { itemId, institutionName, accounts: itemAccounts }
  })
  const knownItemIds = new Set(knownInstitutionGroups.map((group) => group.itemId))
  const institutionGroups = [
    ...knownInstitutionGroups,
    ...[...accountGroups.entries()]
      .filter(([itemId]) => itemId && !knownItemIds.has(itemId))
      .map(([itemId, groupAccounts]) => ({
        itemId,
        institutionName: groupAccounts[0]?._institutionName || groupAccounts[0]?._itemName || 'Connected institution',
        accounts: groupAccounts,
      })),
  ]
  const accountsWithoutItem = accountGroups.get('') || []
  const attentionItems = items.filter((item) => item.status !== 'UPDATED' || (item.executionStatus && item.executionStatus !== 'SUCCESS'))
  return (
    <div className="panel w-full min-w-0 rounded-[24px] bg-white p-5 shadow-soft md:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><p className="eyebrow">Your institutions</p><h2 className="section-title mt-1">Accounts & cards</h2></div>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onImportExisting} disabled={importing} className="small-outline"><RefreshCw size={13} className={importing ? 'animate-spin' : ''} /> Import existing</button>
          <button onClick={() => setShowItemId((value) => !value)} className="small-outline">Import by ID</button>
          <button onClick={onConnect} disabled={connecting} className="small-outline"><Plus size={14} /> New</button>
        </div>
      </div>
      {showItemId && <form className="mb-3 flex flex-wrap gap-2 rounded-xl border border-[#edf1ee] bg-[#fafcfb] p-3" onSubmit={(event) => { event.preventDefault(); const itemId = itemIdDraft.trim(); if (itemId) { onImportItemId(itemId); setItemIdDraft(''); setShowItemId(false) } }}>
        <input className="input h-9 min-w-[220px] flex-1" value={itemIdDraft} onChange={(event) => setItemIdDraft(event.target.value)} placeholder="Paste an existing Pluggy Item ID" aria-label="Existing Pluggy Item ID" />
        <button type="submit" disabled={importing || !itemIdDraft.trim()} className="small-outline">Import connection</button>
      </form>}
      {attentionItems.length > 0 && <div className="mb-3 space-y-2">{attentionItems.map((item) => {
        const status = item.status === 'UPDATING' ? 'Syncing with institution' : item.status === 'WAITING_USER_INPUT' ? 'Waiting for a verification step' : item.status === 'LOGIN_ERROR' ? 'Sign-in needs attention' : item.status === 'OUTDATED' ? 'Last sync did not complete' : item.executionStatus === 'PARTIAL_SUCCESS' ? 'Some data could not be collected' : `Connection status: ${item.status || item.executionStatus || 'unknown'}`
        const canUpdate = item.status !== 'UPDATING'
        return <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5">
          <div className="min-w-0"><p className="truncate text-xs font-bold">{displayInstitutionName(item.id, item.connector?.name || 'Bank connection', displayAliases)}</p><p className="mt-0.5 text-[10px] text-amber-800">{status}</p></div>
          {canUpdate && <button onClick={() => onConnect(item.id)} disabled={connecting} className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-extrabold text-amber-900 shadow-sm">{item.status === 'WAITING_USER_INPUT' ? 'Continue' : 'Update connection'}</button>}
        </div>
      })}</div>}
      {(institutionGroups.length > 0 || accountsWithoutItem.length > 0) && <details className="mb-4 rounded-xl border border-[#2d2537] bg-[#17131f] p-3">
        <summary className="cursor-pointer text-xs font-bold">Display aliases</summary>
        <p className="mt-1 text-[10px] text-muted">Set shorter names for institutions, bank accounts, and cards. These names will replace the full names throughout the app.</p>
        <div className="mt-3 space-y-4">
          {institutionGroups.map((group) => <div key={group.itemId} className="min-w-0 space-y-2">
            <DisplayAliasEditor aliasKey={`institution:${group.itemId}`} alias={displayAliases[`institution:${group.itemId}`]} label="Institution" originalName={group.institutionName} onSave={onAliasSave} />
            {group.accounts.map((account) => {
              const credit = account.type === 'CREDIT'
              const kind = credit ? 'card' : 'account'
              const originalName = account.name || account.marketingName || (credit ? 'Credit card' : 'Bank account')
              const aliasKey = `${kind}:${account.id}`
              return <DisplayAliasEditor key={aliasKey} aliasKey={aliasKey} alias={displayAliases[aliasKey]} label={credit ? 'Card' : 'Account'} originalName={originalName} onSave={onAliasSave} />
            })}
          </div>)}
          {accountsWithoutItem.map((account) => {
            const credit = account.type === 'CREDIT'
            const kind = credit ? 'card' : 'account'
            const aliasKey = `${kind}:${account.id}`
            const originalName = account.name || account.marketingName || (credit ? 'Credit card' : 'Bank account')
            return <DisplayAliasEditor key={aliasKey} aliasKey={aliasKey} alias={displayAliases[aliasKey]} label={credit ? 'Card' : 'Account'} originalName={originalName} onSave={onAliasSave} />
          })}
        </div>
      </details>}
      {accounts.length ? <div className="account-scroll space-y-3">
        {accounts.map((account) => {
          const credit = account.type === 'CREDIT'
          const creditData = account.creditData || {}
          const accountBills = bills.filter((bill) => bill._accountId === account.id).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          const nextBill = accountBills.find((bill) => parseFinanceDate(bill.dueDate) >= today)
          const item = itemById[account.itemId]
          const institutionName = displayInstitutionName(account.itemId, account._institutionName || item?.connector?.name || account._itemName || 'Connected account', displayAliases)
          return <div key={account.id} className="account-row rounded-2xl border border-[#edf1ee] p-4">
            <div className="flex items-start gap-3">
              <div className={`account-icon ${credit ? 'account-icon-card' : 'account-icon-bank'}`}>{credit ? <CreditCard size={18} /> : <Landmark size={18} />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{displayAccountName(account, displayAliases)}</p><p className="mt-0.5 truncate text-[11px] text-muted">{institutionName}{account.number ? ` · ${account.number}` : ''}</p></div>
                  <p className="whitespace-nowrap text-right text-sm font-extrabold">{money(account.balance, account.currencyCode)}</p>
                </div>
                {credit && <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#edf1ee] pt-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Available limit</p><p className="mt-1 text-xs font-bold">{creditData.availableCreditLimit == null ? 'Not reported' : money(creditData.availableCreditLimit, account.currencyCode)}</p></div>
                  <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Next invoice</p><p className="mt-1 text-xs font-bold">{nextBill ? money(nextBill.totalAmount, nextBill.totalAmountCurrencyCode || account.currencyCode) : 'Not reported'}</p><p className="mt-0.5 text-[10px] text-muted">{nextBill ? `Due ${dateLabel(nextBill.dueDate, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No upcoming invoice reported'}</p></div>
                </div>}
                {credit && accountBills.length > 1 && <details className="mt-2 text-[10px] text-muted">
                  <summary className="cursor-pointer font-semibold">{accountBills.length} invoices available</summary>
                  <div className="mt-2 space-y-1">{accountBills.slice(-4).reverse().map((bill) => <div key={bill.id} className="flex justify-between"><span>Due {dateLabel(bill.dueDate, { month: 'short', day: 'numeric' })}</span><span className="font-semibold text-ink">{money(bill.totalAmount, bill.totalAmountCurrencyCode || account.currencyCode)}</span></div>)}</div>
                </details>}
              </div>
            </div>
          </div>
        })}
      </div> : <EmptyState icon={<Landmark size={20} />} title="No accounts connected" detail="Connect a bank or card to start seeing your balances." button={<button className="primary-button mt-4" onClick={onConnect} disabled={connecting}><Plus size={16} /> Connect an account</button>} />}
    </div>
  )
}

function isUncategorizedLabel(category) {
  return !String(category || '').trim() || /^(uncategorized|uncategorised|unknown|other|others|miscellaneous|sem categoria|sem classificacao)$/i.test(String(category).trim())
}

function categoriesForAutocomplete(transactions, overrides) {
  return [...new Set(transactions.map((transaction) => transactionCategory(transaction, overrides)))].filter((category) => !isUncategorizedLabel(category)).sort((a, b) => a.localeCompare(b))
}

function similarExpenseSource(transaction) {
  if (isRecurringExternalTransfer(transaction)) return recurringTransferSource(transaction) || 'Transfer'
  const merchant = transaction.merchant
  const merchantName = typeof merchant === 'string' ? merchant : merchant?.name || merchant?.businessName || merchant?.displayName
  if (merchantName && !/^(pix|transfer|transferencia|purchase|compra|card|cartao|debit|debit card|credit card)$/i.test(merchantName.trim())) return merchantName.trim()
  const raw = String(transaction.descriptionRaw || transaction.description || merchantName || '').trim()
  const pieces = raw.split('|').map((piece) => piece.trim()).filter(Boolean)
  return pieces.length > 1 ? pieces.slice(1).join(' · ') : pieces[0] || 'Unknown expense'
}

function buildSimilarExpenseGroups(transactions, overrides, displayAliases = {}) {
  const groups = new Map()
  const genericSources = new Set(['pix', 'transfer', 'transferencia', 'purchase', 'compra', 'debit purchase', 'credit card purchase', 'payment', 'pagamento', 'withdrawal', 'saque'])
  for (const transaction of transactions) {
    if (!isExpense(transaction) || !isPosted(transaction)) continue
    const source = similarExpenseSource(transaction)
    const key = normalizeRecurringSource(source)
    if (key.length < 4 || genericSources.has(key)) continue
    if (!groups.has(key)) groups.set(key, { key, source, rows: [], categories: new Map(), totals: new Map(), accounts: new Set() })
    const group = groups.get(key)
    group.rows.push(transaction)
    const category = transactionCategory(transaction, overrides)
    group.categories.set(category, (group.categories.get(category) || 0) + 1)
    const currency = transaction.currencyCode || 'BRL'
    group.totals.set(currency, (group.totals.get(currency) || 0) + expenseValue(transaction))
    group.accounts.add(recurringAccountLabel(transaction, displayAliases))
  }

  return [...groups.values()]
    .filter((group) => group.rows.length >= 2)
    .map((group) => {
      const categories = [...group.categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      const known = categories.filter(([category]) => !isUncategorizedLabel(category))
      const suggestedCategory = known.length && (known.length === 1 || known[0][1] > (known[1]?.[1] || 0)) ? known[0][0] : ''
      const uncategorizedCount = group.rows.filter((transaction) => isUncategorizedLabel(transactionCategory(transaction, overrides))).length
      return {
        ...group,
        categories,
        suggestedCategory,
        uncategorizedCount,
        targetRows: uncategorizedCount ? group.rows.filter((transaction) => isUncategorizedLabel(transactionCategory(transaction, overrides))) : group.rows,
        categoryConflict: categories.length > 1,
        accountList: [...group.accounts].sort((a, b) => a.localeCompare(b)),
      }
    })
    .sort((a, b) => b.uncategorizedCount - a.uncategorizedCount
      || Number(b.categoryConflict) - Number(a.categoryConflict)
      || b.rows.length - a.rows.length
      || a.source.localeCompare(b.source))
}

function SimilarExpenseGroupRow({ group, overrides, onSave, onHide }) {
  const [draft, setDraft] = useState(group.suggestedCategory)
  const [saving, setSaving] = useState(false)
  const [hiding, setHiding] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setDraft(group.suggestedCategory), [group.key, group.suggestedCategory])
  const alreadyAssigned = Boolean(draft.trim()) && group.targetRows.every((transaction) => transactionCategory(transaction, overrides) === draft.trim())
  const save = async () => {
    const category = draft.trim()
    if (!category || alreadyAssigned) return
    setSaving(true)
    setError('')
    try {
      await onSave(group.targetRows.map((transaction) => transaction.id), category)
    } catch (err) {
      setError(err.message || 'Could not apply this category.')
    } finally {
      setSaving(false)
    }
  }
  const hide = async () => {
    setHiding(true)
    setError('')
    try { await onHide(group, true) }
    catch (err) { setError(err.message || 'Could not hide this group.') }
    finally { setHiding(false) }
  }
  return <div className="grid min-w-0 gap-3 rounded-xl border border-[#edf1ee] bg-[#171320] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(210px,290px)] sm:items-center">
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2"><p className="break-words text-xs font-bold">{group.source}</p><span className="rounded-full bg-[#28243e] px-2 py-0.5 text-[10px] font-bold text-muted">{group.rows.length} expenses</span>{group.uncategorizedCount > 0 && <span className="rounded-full bg-[#352125] px-2 py-0.5 text-[10px] font-bold text-[#f18a82]">{group.uncategorizedCount} uncategorized</span>}{group.uncategorizedCount === 0 && <button type="button" className="small-outline" onClick={hide} disabled={hiding}>{hiding ? 'Hiding…' : 'Hide reviewed'}</button>}</div>
      <p className="mt-1 text-[10px] text-muted">{formatCurrencyTotals(group.totals)} · {group.accountList.join(' · ')}</p>
      <p className="mt-1 break-words text-[10px] text-muted">Current: {group.categories.map(([category, count]) => `${category} (${count})`).join(' · ')}</p>
      {error && <p className="mt-1 text-[10px] text-rose-600" role="alert">{error}</p>}
    </div>
    <div className="flex min-w-0 gap-2">
      <input className="input h-10" list="expense-category-suggestions" maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Choose category" aria-label={`Category for ${group.source}`} />
      <button className="small-outline shrink-0" type="button" onClick={save} disabled={saving || !draft.trim() || alreadyAssigned}>{saving ? 'Saving…' : `Apply to ${group.targetRows.length}`}</button>
    </div>
  </div>
}

function TransactionsPanel({ data, categoryFilter, setCategoryFilter, search, setSearch, onCategorySave, onBulkCategorySave, onGroupVisibilityChange }) {
  const overrides = data?.categoryOverrides || {}
  const displayAliases = data?.displayAliases || {}
  const transactions = data?.transactions || []
  const [similarSearch, setSimilarSearch] = useState('')
  const [showAllSimilarGroups, setShowAllSimilarGroups] = useState(false)
  const [visibilityError, setVisibilityError] = useState('')
  const similarGroups = useMemo(() => buildSimilarExpenseGroups(transactions, overrides, displayAliases), [transactions, overrides, displayAliases])
  const reviewedGroups = data?.reviewedExpenseGroups || {}
  const isReviewed = (group) => JSON.stringify(group.categories.map(([category]) => category).sort()) === JSON.stringify([...(reviewedGroups[group.key] || [])].sort())
  const activeSimilarGroups = similarGroups.filter((group) => !isReviewed(group))
  const hiddenSimilarGroups = similarGroups.filter(isReviewed)
  const categorySuggestions = categoriesForAutocomplete(transactions, overrides)
  const matchesSimilarSearch = (group) => !similarSearch.trim() || `${group.source} ${group.accountList.join(' ')} ${group.categories.map(([category]) => category).join(' ')}`.toLowerCase().includes(similarSearch.trim().toLowerCase())
  const filteredSimilarGroups = activeSimilarGroups.filter(matchesSimilarSearch)
  const filteredHiddenGroups = hiddenSimilarGroups.filter(matchesSimilarSearch)
  const visibleSimilarGroups = showAllSimilarGroups || similarSearch.trim() ? filteredSimilarGroups : filteredSimilarGroups.slice(0, 12)
  const categories = [...new Set(transactions.map((tx) => transactionCategory(tx, overrides)))].sort((a, b) => a.localeCompare(b))
  const filtered = transactions.filter((tx) => {
    const category = transactionCategory(tx, overrides)
    const matchesCategory = categoryFilter === 'All categories' || category === categoryFilter
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || `${tx.description || ''} ${tx.descriptionRaw || ''} ${transactionAccountLabel(tx, displayAliases)} ${tx._accountName || ''} ${category}`.toLowerCase().includes(query)
    return matchesCategory && matchesSearch
  })
  return (
    <section className="panel w-full min-w-0 rounded-[24px] bg-white p-5 shadow-soft md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Your activity</p><h2 className="section-title mt-1">Transactions</h2><p className="mt-1 text-xs text-muted">{filtered.length.toLocaleString('en-US')} movement{filtered.length === 1 ? '' : 's'} · category edits are saved privately in this app</p></div>
      </div>
      {similarGroups.length > 0 && <div className="mb-6 rounded-2xl border border-[#edf1ee] bg-[#171320] p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-sm font-extrabold">Group similar expenses</h3><p className="mt-1 text-[10px] text-muted">Repeated patterns are grouped together. Hide a fully categorized group once you agree with its categories; new category changes bring it back for review.</p></div>
          <span className="rounded-full border border-[#edf1ee] bg-[#fafcfb] px-3 py-1.5 text-[10px] font-bold text-muted">{activeSimilarGroups.length} to review · {hiddenSimilarGroups.length} hidden</span>
        </div>
        <div className="relative mb-3 min-w-0"><Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input h-10 pl-10" value={similarSearch} onChange={(event) => setSimilarSearch(event.target.value)} placeholder="Find a merchant or current category" aria-label="Search similar expense groups" /></div>
        <datalist id="expense-category-suggestions">{categorySuggestions.map((category) => <option key={category} value={category} />)}</datalist>
        {visibleSimilarGroups.length ? <div className="grid min-w-0 gap-2">{visibleSimilarGroups.map((group) => <SimilarExpenseGroupRow key={group.key} group={group} overrides={overrides} onSave={onBulkCategorySave} onHide={onGroupVisibilityChange} />)}</div> : <p className="py-5 text-center text-xs text-muted">{activeSimilarGroups.length ? 'No groups to review match that search.' : 'All similar expense groups have been reviewed.'}</p>}
        {!showAllSimilarGroups && !similarSearch.trim() && filteredSimilarGroups.length > visibleSimilarGroups.length && <button type="button" className="small-outline mt-3 w-full" onClick={() => setShowAllSimilarGroups(true)}>Show all {filteredSimilarGroups.length} groups</button>}
        {hiddenSimilarGroups.length > 0 && <details className="mt-4 rounded-xl border border-[#2d2537] p-3">
          <summary className="cursor-pointer text-xs font-bold">Reviewed groups ({filteredHiddenGroups.length})</summary>
          <div className="mt-3 grid gap-2">{filteredHiddenGroups.map((group) => <div key={group.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-[#17131f] p-3">
            <div className="min-w-0"><p className="break-words text-xs font-bold">{group.source}</p><p className="mt-1 break-words text-[10px] text-muted">{group.categories.map(([category]) => category).join(' · ')} · {group.rows.length} expenses</p></div>
            <button type="button" className="small-outline" onClick={async () => { setVisibilityError(''); try { await onGroupVisibilityChange(group, false) } catch (err) { setVisibilityError(err.message || 'Could not restore this group.') } }}>Restore</button>
          </div>)}{!filteredHiddenGroups.length && <p className="text-xs text-muted">No reviewed groups match that search.</p>}</div>
        </details>}
        {visibilityError && <p className="mt-2 text-xs text-rose-600" role="alert">{visibilityError}</p>}
      </div>}
      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row">
        <div className="relative w-full min-w-0 flex-1"><Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" /><input className="input h-10 pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search description or account" /></div>
        <div className="relative w-full min-w-0 sm:w-56 sm:flex-none"><Filter size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" /><select className="input h-10 appearance-none pl-10 pr-9" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" /></div>
      </div>
      <div className="transaction-header hidden grid-cols-[minmax(0,1.5fr)_minmax(110px,0.75fr)_minmax(125px,0.8fr)_minmax(110px,0.7fr)] gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted md:grid"><span>Movement</span><span>Date</span><span>Category</span><span className="text-right">Amount</span></div>
      <div className="divide-y divide-[#edf1ee]">
        {filtered.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} category={transactionCategory(transaction, overrides)} categories={categories} displayAliases={displayAliases} onSave={onCategorySave} />)}
      </div>
      {!filtered.length && <EmptyState icon={<ArrowLeftRight size={20} />} title="Nothing found" detail={transactions.length ? 'Try another search or category.' : 'Connect an account and sync your first transactions.'} />}
    </section>
  )
}

function TransactionRow({ transaction, category, categories, displayAliases, onSave }) {
  const [draft, setDraft] = useState(category)
  const [editing, setEditing] = useState(false)
  useEffect(() => setDraft(category), [category])
  const expense = isExpense(transaction)
  const amount = Number(transaction.amount || 0)
  const save = async () => {
    const normalized = draft.trim()
    if (normalized !== category) await onSave(transaction.id, normalized)
    setEditing(false)
  }
  return <div className="transaction-row grid grid-cols-1 gap-2 px-4 py-3.5 md:grid-cols-[minmax(0,1.5fr)_minmax(110px,0.75fr)_minmax(125px,0.8fr)_minmax(110px,0.7fr)] md:items-center md:gap-4">
    <div className="flex min-w-0 items-center gap-3">
      <div className={`movement-icon ${expense ? 'movement-expense' : 'movement-income'}`}>{expense ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</div>
      <div className="min-w-0"><p className="truncate text-sm font-bold">{transaction.description || transaction.descriptionRaw || 'Transaction'}</p><p className="mt-0.5 truncate text-[10px] text-muted">{transactionAccountLabel(transaction, displayAliases)}</p></div>
    </div>
    <div className="flex items-center justify-between text-xs text-muted md:block"> <span className="mr-2 font-semibold md:hidden">Date</span><span>{dateLabel(transaction.date, { month: 'short', day: 'numeric', year: 'numeric' })}{transaction.status === 'PENDING' && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">Pending</span>}</span></div>
    <div className="flex items-center justify-between gap-2"><span className="mr-2 text-xs font-semibold text-muted md:hidden">Category</span>
      {editing ? <div className="flex w-full gap-1"><input className="category-input" list={`cats-${transaction.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus /><datalist id={`cats-${transaction.id}`}>{categories.map((item) => <option key={item} value={item} />)}</datalist><button title="Save category" className="save-category" onClick={save}><Check size={14} /></button><button title="Cancel" className="cancel-category" onClick={() => { setDraft(category); setEditing(false) }}><X size={14} /></button></div> : <button className="category-pill" onClick={() => setEditing(true)} title="Click to edit category"><span>{category}</span><PencilLine size={11} /></button>}
    </div>
    <div className="flex items-center justify-between md:block md:text-right"><span className="text-xs font-semibold text-muted md:hidden">Amount</span><span className={`text-sm font-extrabold ${expense ? 'text-rose-600' : 'text-emerald-700'}`}>{expense ? '−' : '+'}{money(Math.abs(amount), transaction.currencyCode || 'BRL')}</span></div>
  </div>
}

function EmptyState({ icon, title, detail, button }) {
  return <div className="flex flex-col items-center justify-center px-4 py-10 text-center"><div className="empty-icon">{icon}</div><p className="mt-3 text-sm font-bold">{title}</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted">{detail}</p>{button}</div>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)

