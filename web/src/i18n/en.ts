/**
 * Every string the UI shows passes through here (popy.spec §14). The app is
 * English today; the indirection is what lets another language land later
 * without hunting through JSX.
 */
export const en = {
  'app.name': 'Popy',
  'app.loading': 'Loading…',

  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.back': 'Back',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.download': 'Download',
  'common.comingSoon': 'Coming soon',

  'setup.welcome.title': 'Welcome to Popy',
  'setup.welcome.body':
    'This is your own Popy, running on your own server. Start by choosing a password — it is the only way in.',
  'setup.password.label': 'Password',
  'setup.password.confirmLabel': 'Confirm password',
  'setup.password.hint': 'At least 10 characters. Length beats punctuation.',
  'setup.password.mismatch': 'The two passwords do not match.',
  'setup.password.tooShort': 'Use at least 10 characters.',
  'setup.strength.weak': 'Weak',
  'setup.strength.fair': 'Fair',
  'setup.strength.strong': 'Strong',

  'setup.recovery.title': 'Save your recovery key',
  'setup.recovery.body':
    'This key is the only way back in if you forget your password. It is shown once and never again.',
  'setup.recovery.confirm': 'I saved my recovery key',
  'setup.recovery.filename': 'popy-recovery-key.txt',

  'setup.provider.title': 'Connect a model',
  'setup.provider.body':
    'Popy talks to a language model through OpenRouter. Paste an API key to connect — or skip and add one later in Settings.',
  'setup.provider.skip': 'Skip for now',

  'setup.done.title': "You're all set",
  'setup.done.body': 'Popy is ready. Start a conversation whenever you like.',
  'setup.done.enter': 'Open Popy',

  'login.title': 'Welcome back',
  'login.password': 'Password',
  'login.submit': 'Unlock',
  'login.keepSignedIn': 'Keep me signed in',
  'login.forgot': 'Forgot your password?',
  'login.invalid': 'That password did not work.',
  'login.locked': 'Too many attempts. Try again in {seconds}s.',
  'login.rateLimited': 'Too many attempts. Give it a moment.',

  'recover.title': 'Use your recovery key',
  'recover.body': 'Enter the key you saved, then choose a new password.',
  'recover.key': 'Recovery key',
  'recover.newPassword': 'New password',
  'recover.submit': 'Reset password',
  'recover.invalid': 'That recovery key did not work.',
  'recover.newKeyTitle': 'Here is your new recovery key',
  'recover.newKeyBody':
    'The key you just used is now spent. Save this one in its place — it is shown once.',

  'shell.newChat': 'New chat',
  'shell.filter': 'Search conversations',
  'shell.noChats': 'No conversations yet.',
  'shell.archived': 'Archived ({count})',
  'shell.chatMenu': 'Conversation options',
  'shell.rename': 'Rename',
  'shell.archive': 'Archive',
  'shell.unarchive': 'Unarchive',
  'shell.delete': 'Delete',
  'shell.deleteConfirm': 'Delete "{title}"? This cannot be undone.',
  'shell.empty.title': 'Pick up where you left off',
  'shell.empty.body': 'Choose a conversation on the left, or start a new one.',
  'shell.settings': 'Settings',


  'chat.placeholder': 'Message Popy…',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.thinking': 'Thinking',
  'chat.ranTools': 'Ran {count} tools',
  'chat.toolFailed': 'failed',
  'chat.queued': 'Queued: {text}',
  'chat.answering': 'Answering…',
  'chat.waitingTurn': 'Waiting for a free slot…',
  'chat.stopped': 'You stopped this answer.',
  'chat.failed': 'That answer could not be finished.',
  'chat.jumpToLatest': '↓ New messages',
  'chat.model': 'Model',
  'chat.defaultModel': 'Default model',

  'settings.title': 'Settings',
  'settings.section.general': 'General',
  'settings.section.model': 'Model',
  'settings.section.appearance': 'Appearance',
  'settings.section.security': 'Security',
  'settings.section.about': 'About',

  'settings.general.language': 'Language',
  'settings.general.saved': 'Saved',
  'settings.general.instructions': 'Custom instructions',
  'settings.general.instructionsHint':
    'Added to every conversation. How you want Popy to answer, in your own words.',

  'provider.title': 'OpenRouter',
  'provider.keyLabel': 'API key',
  'provider.keyHint': 'Stored encrypted on your server, and never shown again.',
  'provider.configured': 'Configured ✓',
  'provider.configuredEnv': 'Configured by the server environment ✓',
  'provider.notConfigured': 'Not configured',
  'provider.test': 'Test',
  'provider.testing': 'Testing…',
  'provider.testOk': 'The key works.',
  'provider.testOkLatency': 'The key works ({ms} ms).',
  'provider.testFailed': 'The key did not work: {message}',
  'provider.modelsInfo': '{count} models ({source})',
  'provider.source.live': 'live from OpenRouter',
  'provider.source.cache': 'cached catalog',
  'provider.source.engine': 'built-in catalog',
  'provider.source.static': 'fallback list',
  'provider.removeKey': 'Remove key',
  'provider.removeKeyConfirm': 'Remove the stored API key?',
  'provider.defaultModel': 'Default model',
  'provider.serviceModel': 'Service model',
  'provider.serviceModelHint': 'The model Popy uses for background work like titles.',
  'provider.saved': 'Saved',

  'chat.noProvider': 'Popy has no model to talk to yet. Configure a provider in Settings.',
  'chat.noProviderLink': 'Open Settings',

  'settings.appearance.theme': 'Theme',
  'settings.appearance.system': 'System',
  'settings.appearance.light': 'Light',
  'settings.appearance.dark': 'Dark',
  'settings.appearance.note': 'The theme is remembered on this device only.',

  'settings.security.changePassword': 'Change password',
  'settings.security.currentPassword': 'Current password',
  'settings.security.newPassword': 'New password',
  'settings.security.confirmPassword': 'Confirm new password',
  'settings.security.passwordChanged': 'Password changed. Other devices were signed out.',
  'settings.security.signOutOthers': 'Sign out other devices',
  'settings.security.signOutOthersBody':
    'Ends every other session. This device stays signed in.',
  'settings.security.signOutOthersConfirm': 'Sign out everywhere else?',
  'settings.security.signedOutOthers': 'Other devices were signed out.',
  'settings.security.passkeySoon': 'Face ID / fingerprint unlock arrives in a later version.',
  'settings.security.signOut': 'Sign out',

  'settings.about.popy': 'Popy',
  'settings.about.node': 'Node',
  'settings.about.pi': 'pi agent',
  'settings.about.repo': 'Source code',

  'update.available': 'A new version is ready.',
  'update.reload': 'Reload',
  'update.later': 'Not now',

  'error.generic': 'Something went wrong. Try again.',
  'error.offline': 'Popy is offline.',
} as const;

export type TranslationKey = keyof typeof en;
