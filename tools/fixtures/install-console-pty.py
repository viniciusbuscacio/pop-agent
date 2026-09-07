# Test-only PTY driver. Python is not required by the installer.
import errno
import json
import os
import pty
import select
import signal
import sys
import termios
import time

helper, entry, home, action = sys.argv[1:]
pid, master = pty.fork()
if pid == 0:
    os.environ['HOME'] = home
    os.environ['XDG_STATE_HOME'] = home
    args = ['bash', helper, entry, '--prepare-only']
    if action == 'auth':
        os.environ['PATH'] = home + '/bin:' + os.environ['PATH']
        args.append('--install-apt-packages')
    if action == 'verbose':
        args.append('--verbose')
    os.execvp('bash', args)
before = termios.tcgetattr(master)
output = b''
sent = False
authenticated = False
deadline = time.monotonic() + 12
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output += data
            if action == 'auth' and not authenticated and b'Fixture password:' in output:
                os.write(master, b'D-secret-password\n')
                authenticated = True
            if not sent and b'Downloading the runtime' in output:
                if action in ('details', 'auth'):
                    os.write(master, b'D')
                elif action == 'interrupt':
                    os.write(master, b'\x03')
                sent = True
    else:
        raise RuntimeError('installer PTY timed out')
    _, status = os.waitpid(pid, 0)
    after = termios.tcgetattr(master)
    mask = termios.ECHO | termios.ICANON
    print(json.dumps({'output': output.decode(errors='replace'),
                      'status': os.waitstatus_to_exitcode(status),
                      'restored': before[3] & mask == after[3] & mask}))
finally:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.close(master)
