import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js'

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
})
const $ = (id) => document.getElementById(id)

function showMessage(text, kind = '') {
  $('activationMessage').textContent = text
  $('activationMessage').className = `message ${kind}`
}

function urlError() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(location.search)
  return hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error')
}

async function initialize() {
  const linkError = urlError()
  if (linkError) {
    $('activationIntro').textContent = 'This activation link could not be accepted.'
    showMessage(decodeURIComponent(linkError.replace(/\+/g, ' ')), 'error')
    return
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    $('activationIntro').textContent = 'This invitation is invalid or has expired.'
    showMessage('Ask your administrator to resend the activation email.', 'error')
    return
  }

  $('activationIntro').textContent = `Activate ${data.session.user.email ?? 'your Mobile ID account'} by choosing a password.`
  $('activationForm').classList.remove('hidden')
}

$('activationForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  const password = $('newPassword').value
  const confirmPassword = $('confirmPassword').value
  if (password.length < 12) return showMessage('Use a password of at least 12 characters.', 'error')
  if (password !== confirmPassword) return showMessage('The passwords do not match.', 'error')

  showMessage('Activating account...')
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return showMessage(error.message, 'error')

  await supabase.auth.signOut()
  $('activationForm').classList.add('hidden')
  $('activationIntro').textContent = 'Your Mobile ID account is activated.'
  showMessage('You can now sign in to the Mobile ID app with your email address and new password.', 'success')
  $('loginLink').classList.remove('hidden')
  history.replaceState(null, '', location.pathname)
})

initialize()
