import type { ReactNode } from 'react';

/** Uppercase muted section heading used at the top of every manage section.
 *  Identical style is repeated across CategoryManager / FamilyMemberManager /
 *  ChoreManager / PhotoManager — extracted here so changes apply once. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="font-semibold text-text-muted"
      style={{
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
      }}
    >
      {children}
    </h2>
  );
}
