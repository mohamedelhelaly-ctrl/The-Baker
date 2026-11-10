import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { buttonClass } from "../../components/ui/buttonClass";
import { useApi } from "../../hooks/useApi";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatTime, hhmm } from "../../lib/dates";
import { todayEntry } from "../../lib/hours";
import { useStore } from "../../lib/store";
import type { Page, ProductListItem } from "../../lib/types";

export default function HomePage() {
  const store = useStore();
  usePageTitle("Bakery in Cairo, baked to order");
  const favourites = useApi<Page<ProductListItem>>("/products?sort=featured&page_size=4");
  const heroButton = useRef<HTMLAnchorElement>(null);
  const figure = useRef<HTMLElement>(null);
  const [arrived, setArrived] = useState(false);
  const first = todayEntry(store.opening_hours);
  const openFrom = first && !first.is_closed ? formatTime(hhmm(first.opens_at)) : null;
  const sub = openFrom ? `Cakes, pastries and bread from ${openFrom}, for delivery or pickup.` : "Cakes, pastries and bread, for delivery or pickup.";

  // The phone's action bar shows once the hero's button has scrolled away.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".actionbar");
    const hero = heroButton.current;
    if (!bar || !hero || typeof IntersectionObserver === "undefined") return;
    const state = { hero: true };
    const apply = () => (bar.dataset.show = String(!state.hero));
    const heroObs = new IntersectionObserver(([e]) => {
      state.hero = e.isIntersecting;
      apply();
    });
    heroObs.observe(hero);
    apply();
    return () => {
      heroObs.disconnect();
    };
  }, []);

  // The one moment: the section's photograph develops once as it comes on screen.
  useEffect(() => {
    const el = figure.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setArrived(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setArrived(true);
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="overflow-hidden">
          <img
            src="/photos/baker-cover-1920.webp"
            srcSet="/photos/baker-cover-800.webp 800w, /photos/baker-cover-1280.webp 1280w, /photos/baker-cover-1920.webp 1920w"
            sizes="(max-width: 639px) 189vw, 100vw"
            width={1920}
            height={1076}
            alt="A paper-craft baker in a white hat setting out pastries at a counter, with shelves of cakes and bread behind"
            fetchPriority="high"
            data-source="client"
            className="enter-settle block h-[min(480px,53svh)] w-full object-cover object-[50%_62%] max-sm:h-[min(488px,48svh)]"
          />
        </div>
        <div className="wrap page grid gap-x-10 gap-y-6 pb-12 pt-10 sm:grid-cols-2 sm:pb-16">
          <div className="enter-mask">
            <h1 id="hero-h" className="enter-rise font-display text-[32px] leading-[37px] sm:text-5xl sm:leading-[1.1]">
              Bakery in Cairo, baked to order
            </h1>
          </div>
          <div>
            <p className="enter-fade text-lg sm:text-xl sm:leading-[30px]" style={{ animationDelay: "480ms" }}>
              {sub}
            </p>
            <p className="enter-fade mt-6" style={{ animationDelay: "540ms" }}>
              <Link ref={heroButton} to="/menu" className={buttonClass("primary", "px-8 max-sm:w-full")}>
                Order now
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="m-arrow">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="fav-h" className="page py-16 sm:py-24">
        <div className="mb-8 flex items-end justify-between gap-4">
          <h2 id="fav-h" className="font-display text-2xl sm:text-[32px] sm:leading-10">
            Our favourites
          </h2>
          <Link to="/menu" className="link">
            See the whole menu
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          {favourites.data?.items.slice(0, 4).map((p) => (
            <li key={p.id}>
              <Link to={`/products/${p.slug}`} className="group block">
                <span className="lift block overflow-hidden border border-hairline bg-tint">
                  {p.image && <img src={p.image.url} alt={p.image.alt_text} loading="lazy" width={600} height={600} className="aspect-square w-full object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]" />}
                </span>
                <span className="link-bare mt-3 inline-block font-display text-xl leading-snug">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="about" aria-labelledby="about-h" className="band">
        <div className="page grid items-center gap-x-10 gap-y-8 py-16 sm:py-24 md:grid-cols-2">
          <div>
            <h2 id="about-h" className="mb-5 font-display text-2xl sm:text-[32px] sm:leading-10">
              About us
            </h2>
            <p className="font-display text-2xl leading-snug sm:text-[28px]">A little bakery, a lot of love, and flavors worth coming back for.</p>
            <p className="mt-5 max-w-prose text-lg">
              We are a small bakery in Cairo. Everything is baked to order, so your cake or loaf comes out of the oven close to the day you collect it or we deliver it. We keep the menu short and bake it well: cakes for birthdays and weddings, pastries for the morning, and bread for the table.
            </p>
          </div>
          <figure ref={figure} className="develop m-0 overflow-hidden" data-state={arrived ? "arrived" : "waiting"} data-moment="picture-develops">
            <img
              src="/photos/baker-icon.webp"
              width={772}
              height={900}
              loading="lazy"
              alt="A smiling baker in a chef's hat holding a loaf of bread on a board, drawn in brown ink"
              data-source="client"
              className="mx-auto block h-auto max-h-[460px] w-full object-contain mix-blend-multiply"
            />
          </figure>
        </div>
      </section>
    </>
  );
}
