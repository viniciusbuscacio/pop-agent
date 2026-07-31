import { describe, expect, it } from 'vitest';
import { filesCatalogBlock } from './files-catalog.js';

const FOLDERS = [{ id: 'fld-1', name: 'Music' }];

describe('filesCatalogBlock', () => {
  it('is empty when there are no files', () => {
    expect(filesCatalogBlock([], FOLDERS)).toBe('');
  });

  it('lists names, with the folder as a prefix', () => {
    const block = filesCatalogBlock(
      [
        { name: 'Ajustes Letras OffSchool.docx', folderId: 'fld-1' },
        { name: 'notes.md', folderId: '' },
      ],
      FOLDERS,
    );
    expect(block).toContain('- Music/Ajustes Letras OffSchool.docx');
    expect(block).toContain('- notes.md');
    expect(block).toContain('files_search');
  });

  it('caps the list and says how much files_search covers', () => {
    const files = Array.from({ length: 33 }, (_, i) => ({ name: `f${String(i)}.txt`, folderId: '' }));
    const block = filesCatalogBlock(files, []);
    expect(block).toContain('- f29.txt');
    expect(block).not.toContain('- f30.txt');
    expect(block).toContain('(and 3 more');
  });
});
