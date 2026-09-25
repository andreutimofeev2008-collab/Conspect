export const przedmioty = [
  {
    slug: "pracownia-urzadzen-sieciowych",
    nazwa: "Pracownia urządzeń sieciowych",
  },
  {
    slug: "pracownia-urzadzen-techniki-komputerowej",
    nazwa: "Pracownia urządzeń techniki komputerowej",
  },
  {
    slug: "projektowanie-i-administrowanie-bazami-danych",
    nazwa: "Projektowanie i administrowanie bazami danych",
  },
  { slug: "jezyk-angielski", nazwa: "Język angielski" },
  { slug: "matematyka", nazwa: "Matematyka" },
  { slug: "fizyka", nazwa: "Fizyka" },
  { slug: "jezyk-niemiecki", nazwa: "Język niemiecki" },
  { slug: "edukacja-obywatelska", nazwa: "Edukacja obywatelska" },
  { slug: "geografia", nazwa: "Geografia" },
  {
    slug: "programowanie-i-obsluga-drukarek-3d",
    nazwa: "Programowanie i obsługa drukarek 3D",
  },
  { slug: "jezyk-polski", nazwa: "Język polski" },
  { slug: "chemia", nazwa: "Chemia" },
  { slug: "historia", nazwa: "Historia" },
] as const;

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pl-PL");
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("pl-PL")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function przedmiotSlug(nazwa: string): string {
  return (
    przedmioty.find((przedmiot) => przedmiot.nazwa === nazwa)?.slug ??
    slugify(nazwa)
  );
}

export function grupyTytulow<
  T extends { id: string; data: { tytul: string; przedmiot: string } },
>(notatki: T[], nazwaPrzedmiotu: string) {
  const grupy = new Map<string, { tytul: string; notatki: T[] }>();

  for (const notatka of notatki) {
    if (notatka.data.przedmiot !== nazwaPrzedmiotu) continue;

    const klucz = normalizeTitle(notatka.data.tytul);
    const grupa = grupy.get(klucz) ?? {
      tytul: notatka.data.tytul.trim().replace(/\s+/g, " "),
      notatki: [],
    };

    grupa.notatki.push(notatka);
    grupy.set(klucz, grupa);
  }

  const zajeteSlugi = new Set<string>();

  return [...grupy.entries()]
    .sort((a, b) =>
      a[1].tytul.localeCompare(b[1].tytul, "pl", { sensitivity: "base" }),
    )
    .map(([klucz, grupa]) => {
      const baza = slugify(grupa.tytul) || "temat";
      let slug = baza;
      let numer = 2;

      while (zajeteSlugi.has(slug)) {
        slug = `${baza}-${numer++}`;
      }

      zajeteSlugi.add(slug);

      return { klucz, slug, ...grupa };
    });
}
