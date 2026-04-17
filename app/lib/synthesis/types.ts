// Shared shape for a synthesized paragraph with clickable spans.
// A paragraph is an ordered list of spans. Plain-text spans have no ref;
// linked spans either point to an existing concept (`known`) or suggest a
// new concept the user can promote by clicking (`candidate`).

export type PlainSpan = { text: string };
export type KnownSpan = { text: string; ref: string; kind: 'known' };
export type CandidateSpan = { text: string; ref: string; kind: 'candidate' };
export type Span = PlainSpan | KnownSpan | CandidateSpan;

export type Paragraph = Span[];

export interface SynthesisRecord {
  slug: string;
  paragraph: Paragraph;
  generator?: string;
  model?: string;
}

export interface SynthesisPrepEntity {
  slug: string;
  name: string;
  type: string;
  aliases: string[];
  mention_count: number;
  document_count: number;
  known_concepts: Array<{ slug: string; name: string; type: string }>;
  evidence: Array<{
    doc_title: string;
    doc_status: string;
    heading: string | null;
    body: string;
  }>;
}

export interface SynthesisPrep {
  generated_at: number;
  project_name: string;
  entities: SynthesisPrepEntity[];
}
