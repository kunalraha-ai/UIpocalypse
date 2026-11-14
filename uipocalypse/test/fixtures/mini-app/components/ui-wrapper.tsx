'use client';

// Fixture: UI-library wrapper — handlers arrive via {...props} at call sites.
// The speculative dead-handler branch must NOT fire (FP audit: shadcn/taxonomy).
export default function UiWrapper(props: { onClick?: () => void; className?: string }) {
  return <button className={props.className} onClick={props.onClick} {...props} />;
}

export function DisabledToggle() {
  return (
    <div>
      <button disabled>Coming soon</button>
      <button type="submit">Invisible submit</button>
    </div>
  );
}
