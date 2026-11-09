/** The photographs on the home page are stand-ins (licensed, from Wikimedia Commons). One footer line, the list on open. */
const HOME_PHOTOS = [
  { title: "Bread dough in proving baskets", by: "Wald1siedel", licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", page: "https://commons.wikimedia.org/wiki/File:Bread_dough_in_baskets_01.JPG" },
] as const;

export function PhotoCredits() {
  return (
    <details className="credits text-sm text-muted">
      <summary className="cursor-pointer py-2">Photographs via Wikimedia Commons</summary>
      <ul className="mt-1 grid gap-1 pb-2">
        {HOME_PHOTOS.map((p) => (
          <li key={p.page}>
            <a className="link" href={p.page} target="_blank" rel="noreferrer">
              {p.title}
            </a>
            , {p.by}, <a className="link" href={p.licenceUrl} target="_blank" rel="noreferrer">{p.licence}</a>
          </li>
        ))}
      </ul>
    </details>
  );
}
