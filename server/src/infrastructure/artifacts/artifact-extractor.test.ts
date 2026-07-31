import { describe, expect, it } from 'vitest';
import { docxXmlToText } from './artifact-extractor.js';

describe('docxXmlToText', () => {
  it('turns paragraphs into lines and strips tags', () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>First line</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second</w:t></w:r><w:r><w:t> line</w:t></w:r></w:p>' +
      '</w:body></w:document>';

    expect(docxXmlToText(xml)).toBe('First line\nSecond line');
  });

  it('decodes entities and honours breaks and tabs', () => {
    const xml =
      '<w:p><w:r><w:t>A &amp; B</w:t><w:tab/><w:t>C</w:t><w:br/><w:t>D</w:t></w:r></w:p>';

    expect(docxXmlToText(xml)).toBe('A & B\tC\nD');
  });

  it('is empty for a document with no text', () => {
    expect(docxXmlToText('<w:document><w:body></w:body></w:document>')).toBe('');
  });
});
