// Planted bug #6: assumes the name always has at least two words.
// Garbage input without spaces (e.g. the 10k-char nasty input) crashes the page
// with an unhandled TypeError during render.
export default function NameTag({ name }: { name: string }) {
  const [first, last] = name.split(' ');
  return (
    <span className="nametag" title="Initials">
      {first[0]}
      {last[0]}
    </span>
  );
}
