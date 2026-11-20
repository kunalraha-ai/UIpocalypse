export default function Spinner({ label }: { label: string }) {
  return <div className="spinner" role="progressbar" aria-label={label} />;
}
