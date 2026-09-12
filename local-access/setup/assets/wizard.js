/* Family wizard presentation. Privileged operations exist only in the Go binding. */
(() => {
  const $ = id => document.getElementById(id);
  let step = 'welcome';
  let busy = false;
  let state;
  let poll;
  const api = () => window.go.main.Setup;
  const text = (id, value) => { $(id).textContent = value; };
  function error(message) { text('error', message || ''); $('error').hidden = !message; }
  function show(next) {
    step = next;
    document.querySelectorAll('[data-step]').forEach(el => { el.hidden = el.dataset.step !== step; });
    $('back').hidden = !['license', 'components', 'connection', 'destination'].includes(step);
    $('next').hidden = step === 'installing';
    text('next', { welcome:state?.platform === 'darwin' ? 'Continue' : 'Next', license:'I agree', components:state?.platform === 'darwin' ? 'Continue' : 'Next', connection:state?.platform === 'darwin' ? 'Continue' : 'Next', destination:'Install', done:'Finish', uninstall:'Uninstall' }[step] || 'Next');
    $('next').classList.toggle('danger', step === 'uninstall');
    $('cancel').hidden = step === 'done';
    setBusy(busy);
    const heading = document.querySelector(`[data-step="${step}"] h1`);
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }
  function setBusy(value) {
    busy = value;
    ['next','back','cancel','close','remove'].forEach(id => { $(id).disabled = busy; });
  }
  function theme(value) {
    document.documentElement.dataset.theme = value;
    $('theme').setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} theme`);
  }
  $('theme').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  theme(matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  $('minimize').onclick = () => api().Minimize();
  $('close').onclick = $('cancel').onclick = () => { if (!busy) { $('password').value = ''; api().Close(); } };
  $('project').onclick = () => api().OpenProject();
  $('remove').onclick = () => { error(''); show('uninstall'); };
  $('back').onclick = () => { error(''); show({ license:'welcome', components:'license', connection:'components', destination:'connection' }[step]); };
  $('server').addEventListener('input', () => { $('password').placeholder = ''; });
  $('next').onclick = async () => {
    if (busy) return;
    error('');
    if (step === 'welcome') return show('license');
    if (step === 'license') return show('components');
    if (step === 'components') {
      if (!$('component-desktop').checked && !$('component-cli').checked) { error('Select Pop Agent Desktop, Pop Agent CLI, or both.'); return; }
      text('component-summary', [$('component-desktop').checked ? 'Pop Agent Desktop' : '', $('component-cli').checked ? 'Pop Agent CLI' : ''].filter(Boolean).join(' and '));
      return show('connection');
    }
    if (step === 'connection') {
      if (!$('server').checkValidity() || !$('server').value.trim()) { $('server').reportValidity(); return; }
      return show('destination');
    }
    if (step === 'destination') {
      setBusy(true); show('installing');
      poll = setInterval(async () => {
        try { const current = await api().GetState(); text('stage', current.stage); } catch { /* the awaited install reports failure */ }
      }, 400);
      try {
        const result = await api().Install($('server').value.trim(), $('password').value, $('component-desktop').checked, $('component-cli').checked);
        $('password').value = '';
        if (result) { show('connection'); error(result); }
        else {
          const installed = await api().GetState();
          const hasDesktop = installed.components?.desktop ?? $('component-desktop').checked;
          document.querySelectorAll('[data-desktop-choice]').forEach(el => { el.hidden = !hasDesktop; });
          text('installed-summary', hasDesktop ? 'Pop Agent is installed. Open Desktop to sign in to the app.' : 'Pop Agent CLI is installed. Open a new terminal and run pop.');
          show('done');
        }
      } catch { $('password').value = ''; show('connection'); error('Installation did not complete. Please retry.'); }
      finally { clearInterval(poll); setBusy(false); }
    } else if (step === 'done') {
      setBusy(true);
      try { error(await api().Finish($('start-menu').checked, $('desktop').checked, $('startup').checked, $('launch').checked)); }
      catch { error('Could not finish installation. Please retry.'); }
      finally { setBusy(false); }
    } else if (step === 'uninstall') {
      setBusy(true);
      try { error(await api().Uninstall(true)); }
      catch { error('Uninstall did not complete. Please retry.'); }
      finally { setBusy(false); }
    }
  };
  async function start() {
    try {
      state = await api().GetState();
      if (state.platform === 'darwin') {
        text('account-destination', 'Install for your macOS account in:');
        $('start-menu').closest('label').hidden = true;
        $('desktop').closest('label').hidden = true;
        $('desktop').closest('label').removeAttribute('data-desktop-choice');
        $('startup').closest('label').querySelector('span').textContent = 'Start at Login';
      }
      text('version', state.installed ? `Update to version ${state.version}${state.installedVersion ? ` (installed: ${state.installedVersion})` : ' from your existing installation'}.` : `Version ${state.version} · Installed for your ${state.platform === 'darwin' ? 'macOS' : 'Windows'} account.`);
      text('welcome-title', state.installed ? 'Update Pop Agent' : 'Welcome to Pop Agent');
      text('license', state.license);
      text('directory', state.directory);
      $('server').value = state.server || '';
      $('startup').checked = state.startAtLogin;
      $('preview').hidden = !state.preview;
      $('remove').hidden = !state.installedVersion;
      if (state.savedLogin) { $('password').placeholder = 'Leave blank to keep your saved sign-in'; }
      if (state.error) error(state.error);
      show(state.uninstall ? 'uninstall' : 'welcome');
    } catch { error('The installer could not start. Close it and download a fresh copy.'); $('next').disabled = true; }
  }
  start();
})();
