/** Durable crash journal for a reviewed Auto-Skill filesystem publication. */
export interface AutoSkillPublication {
  id: string;
  slug: string;
  action: 'new' | 'revision';
  reviewHash: string;
  tempPath: string;
  destination: string;
  backupPath?: string;
  state: 'prepared' | 'committed';
  preparedAt: string;
  committedAt?: string;
}

export interface AutoSkillPublicationRepo {
  prepare(operation: AutoSkillPublication): void;
  commit(id: string, at: string): void;
  delete(id: string): void;
  open(): AutoSkillPublication[];
}
