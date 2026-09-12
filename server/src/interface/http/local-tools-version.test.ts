import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { versionFrames } from './local-tools-routes.js';

let pack: string;
beforeEach(() => {
  pack = mkdtempSync(join(tmpdir(), 'pop-local-version-'));
  writeFileSync(join(pack, 'package.json'), JSON.stringify({ version: '0.2.103' }));
  writeFileSync(join(pack, 'cli-0.2.103.tgz'), 'published client');
});
afterEach(() => rmSync(pack, { recursive: true, force: true }));
const frames = (client: string) => versionFrames(client, { popAgentVersion: '0.2.106' }, 'https://pop.example/v1/local-tools', pack);

describe('local access independent client versions', () => {
  it('does not warn when the installed CLI matches the published client despite a newer server', () => {
    expect(frames('0.2.103')).toEqual({});
    expect(frames('0.2.104')).toEqual({});
  });
  it('warns when a newer downloadable CLI exists', () => {
    expect(frames('0.2.91').warning).toEqual({ kind: 'version_warning', server: '0.2.106', install: 'npm i -g https://pop.example/cli-latest.tgz' });
  });
  it('does not advertise an unavailable client archive', () => {
    rmSync(join(pack, 'cli-0.2.103.tgz'));
    expect(frames('0.2.91')).toEqual({});
  });
  it('still refuses clients below the protocol minimum even without a packaged update', () => {
    rmSync(join(pack, 'package.json'));
    expect(frames('0.0.1').outdated).toMatchObject({ kind: 'outdated' });
    expect(frames('').outdated).toMatchObject({ kind: 'outdated' });
  });
});
