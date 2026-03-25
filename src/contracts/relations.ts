export type RelationType =
  | 'import' | 'call' | 'extend' | 'implement'
  | 'override' | 'mixin' | 'use' | 'contain' | 'create'
  | 'parameter' | 'return' | 'throw' | 'decorate';

export type Relation = {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  location: {
    file: string;
    line: number;
    column: number;
  };
  weight: number;
  confidence: number;
};
