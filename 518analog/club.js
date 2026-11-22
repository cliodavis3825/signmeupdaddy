// Set CONTACT_EMAIL to show a "email us" option for issues and questions.
const CONTACT_EMAIL = '';
if (CONTACT_EMAIL) {
  const a = document.getElementById('issue-mail');
  a.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('518 Analog: issue report');
  a.removeAttribute('target');
  a.textContent = 'Email us about a problem';
  document.getElementById('issue-note').textContent = 'Include the event name and what you expected to happen. A real person reads everything.';
}
