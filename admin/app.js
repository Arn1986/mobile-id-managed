import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
import { ADMIN_FUNCTION, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
const $ = (id) => document.getElementById(id)

let currentSite = null
let users = []

function message(id, text = '', kind = '') {
  const el = $(id)
  el.textContent = text
  el.className = `message ${kind}`
}

async function callAdmin(action, payload = {}) {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Your session has expired. Sign in again.')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${ADMIN_FUNCTION}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    throw new Error(body?.error?.message || `Request failed (${response.status})`)
  }
  return body
}

async function signIn(event) {
  event.preventDefault()
  message('loginMessage', 'Signing in...')
  const { error } = await supabase.auth.signInWithPassword({
    email: $('loginEmail').value.trim(),
    password: $('loginPassword').value,
  })
  if (error) return message('loginMessage', error.message, 'error')
  await boot()
}

async function boot() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    $('loginPanel').classList.remove('hidden')
    $('appPanel').classList.add('hidden')
    $('sessionBar').classList.add('hidden')
    return
  }

  try {
    const info = await callAdmin('bootstrap')
    $('loginPanel').classList.add('hidden')
    $('appPanel').classList.remove('hidden')
    $('sessionBar').classList.remove('hidden')
    $('sessionUser').textContent = data.session.user.email ?? ''
    currentSite = info.site
    applySite(info.site)
    await loadUsers()
  } catch (error) {
    await supabase.auth.signOut()
    $('loginPanel').classList.remove('hidden')
    message('loginMessage', error.message, 'error')
  }
}

async function loadUsers() {
  const data = await callAdmin('listUsers', { search: $('userSearch').value.trim() })
  users = data.users
  $('userRows').innerHTML = users.map((user) => `
    <tr>
      <td>${escapeHtml(`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim())}</td>
      <td>${escapeHtml(user.email ?? '')}</td>
      <td><code>${escapeHtml(user.identifierNumber ?? '')}</code></td>
      <td>${escapeHtml(user.externalId ?? '')}</td>
      <td><span class="status ${user.active ? 'active' : 'inactive'}">${user.active ? 'Active' : 'Inactive'}</span></td>
      <td><span class="status ${user.accountStatus === 'activated' ? 'active' : 'inactive'}">${user.accountStatus === 'activated' ? 'Activated' : 'Pending activation'}</span></td>
      <td class="row gap">
        <button class="secondary edit-user" data-id="${user.id}">Edit</button>
        ${user.accountStatus === 'pending_activation' ? `<button class="secondary resend-activation" data-id="${user.id}">Resend activation</button>` : ''}
      </td>
    </tr>
  `).join('')
  document.querySelectorAll('.edit-user').forEach((button) => button.addEventListener('click', () => editUser(button.dataset.id)))
  document.querySelectorAll('.resend-activation').forEach((button) => button.addEventListener('click', () => resendActivation(button.dataset.id)))
}

async function resendActivation(id) {
  const user = users.find((item) => item.id === id)
  if (!user) return
  if (!confirm(`Send a new activation email to ${user.email}?`)) return
  message('userMessage', 'Sending activation email...')
  try {
    await callAdmin('resendActivation', { id })
    message('userMessage', 'Activation email sent.', 'success')
    await loadUsers()
  } catch (error) {
    message('userMessage', error.message, 'error')
  }
}

function editUser(id) {
  const user = users.find((item) => item.id === id)
  if (!user) return
  $('editingUserId').value = user.id
  $('firstName').value = user.firstName ?? ''
  $('lastName').value = user.lastName ?? ''
  $('email').value = user.email ?? ''
  $('identifierNumber').value = user.identifierNumber ?? ''
  $('externalId').value = user.externalId ?? ''
  $('active').checked = Boolean(user.active)
  $('userFormTitle').textContent = 'Edit user'
  $('saveUserButton').textContent = 'Save changes'
  $('cancelEdit').classList.remove('hidden')
  $('inviteRow').classList.add('hidden')
  $('overwriteRow').classList.add('hidden')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function resetUserForm() {
  $('userForm').reset()
  $('editingUserId').value = ''
  $('active').checked = true
  $('sendInvite').checked = true
  $('userFormTitle').textContent = 'Create user'
  $('saveUserButton').textContent = 'Create user'
  $('cancelEdit').classList.add('hidden')
  $('inviteRow').classList.remove('hidden')
  $('overwriteRow').classList.remove('hidden')
}

async function saveUser(event) {
  event.preventDefault()
  message('userMessage', 'Saving...')
  const id = $('editingUserId').value
  const user = {
    firstName: $('firstName').value.trim(),
    lastName: $('lastName').value.trim(),
    email: $('email').value.trim(),
    identifierNumber: $('identifierNumber').value.trim(),
    externalId: $('externalId').value.trim() || null,
    active: $('active').checked,
  }
  if (!id) {
    user.sendInvite = $('sendInvite').checked
    user.overwrite = $('overwrite').checked
  }

  try {
    await callAdmin(id ? 'updateUser' : 'createUser', id ? { id, user } : { user })
    message('userMessage', id ? 'User updated.' : 'User created.', 'success')
    resetUserForm()
    await loadUsers()
  } catch (error) {
    message('userMessage', error.message, 'error')
  }
}

function applySite(site) {
  currentSite = site
  $('bleReaderName').value = site.ble_reader_name ?? ''
  $('badgeColorStart').value = site.badge_color_start ?? '#4935A3'
  $('badgeColorEnd').value = site.badge_color_end ?? '#7A5BE7'
  $('credentialTtlHours').value = site.credential_ttl_hours ?? 24
  $('badgePreview').style.background = `linear-gradient(135deg, ${$('badgeColorStart').value}, ${$('badgeColorEnd').value})`
  $('siteMeta').textContent = `Config version ${site.config_version} · site ${site.name}`
  if (site.logo_path) {
    const { data } = supabase.storage.from('badge-assets').getPublicUrl(site.logo_path)
    $('badgeLogo').src = data.publicUrl
    $('badgeLogo').classList.remove('hidden')
  } else {
    $('badgeLogo').removeAttribute('src')
    $('badgeLogo').classList.add('hidden')
  }
}

async function pngHasTransparency(file) {
  if (file.type !== 'image/png') return false
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true
  return false
}

async function uploadLogo(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2 MB or smaller.')
  if (file.type !== 'image/png' || !file.name.toLowerCase().endsWith('.png')) throw new Error('Logo must be a PNG file.')
  if (!(await pngHasTransparency(file))) throw new Error('Logo PNG must contain transparent pixels.')
  const path = `sites/${currentSite.id}/logo-${Date.now()}.png`
  const { error } = await supabase.storage.from('badge-assets').upload(path, file, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error
  return path
}

async function saveSite(event) {
  event.preventDefault()
  message('siteMessage', 'Saving...')
  try {
    let logoPath = currentSite.logo_path ?? null
    const file = $('logoFile').files?.[0]
    if (file) logoPath = await uploadLogo(file)
    const data = await callAdmin('updateSite', {
      site: {
        bleReaderName: $('bleReaderName').value.trim(),
        badgeColorStart: $('badgeColorStart').value,
        badgeColorEnd: $('badgeColorEnd').value,
        credentialTtlHours: Number($('credentialTtlHours').value),
        logoPath,
      },
    })
    applySite(data.site)
    $('logoFile').value = ''
    message('siteMessage', 'Site configuration saved.', 'success')
  } catch (error) {
    message('siteMessage', error.message, 'error')
  }
}

async function removeLogo() {
  if (!currentSite?.logo_path) return
  message('siteMessage', 'Removing logo...')
  try {
    const oldPath = currentSite.logo_path
    const data = await callAdmin('updateSite', { site: { logoPath: null } })
    applySite(data.site)
    await supabase.storage.from('badge-assets').remove([oldPath])
    message('siteMessage', 'Logo removed.', 'success')
  } catch (error) {
    message('siteMessage', error.message, 'error')
  }
}

async function loadAudit() {
  const data = await callAdmin('audit')
  $('auditRows').innerHTML = data.events.map((event) => `
    <tr>
      <td>${escapeHtml(new Date(event.created_at).toLocaleString())}</td>
      <td>${escapeHtml(event.event_type)}</td>
      <td>${escapeHtml(event.actor ?? '')}</td>
      <td><code>${escapeHtml(JSON.stringify(event.metadata ?? {}))}</code></td>
    </tr>
  `).join('')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name))
  document.querySelectorAll('.tab-page').forEach((page) => page.classList.add('hidden'))
  $(`tab-${name}`).classList.remove('hidden')
  if (name === 'audit') loadAudit().catch((error) => console.error(error))
}

$('loginForm').addEventListener('submit', signIn)
$('logoutButton').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload() })
$('userForm').addEventListener('submit', saveUser)
$('cancelEdit').addEventListener('click', resetUserForm)
$('refreshUsers').addEventListener('click', () => loadUsers().catch((error) => message('userMessage', error.message, 'error')))
$('userSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); loadUsers() } })
$('siteForm').addEventListener('submit', saveSite)
$('removeLogo').addEventListener('click', removeLogo)
$('refreshAudit').addEventListener('click', () => loadAudit().catch(console.error))
$('badgeColorStart').addEventListener('input', () => $('badgePreview').style.background = `linear-gradient(135deg, ${$('badgeColorStart').value}, ${$('badgeColorEnd').value})`)
$('badgeColorEnd').addEventListener('input', () => $('badgePreview').style.background = `linear-gradient(135deg, ${$('badgeColorStart').value}, ${$('badgeColorEnd').value})`)
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)))

supabase.auth.onAuthStateChange((_event, session) => { if (!session) boot() })
boot()
