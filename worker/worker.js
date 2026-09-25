const DOZWOLONE_ORIGINS = [
  "https://andreutimofeev2008-collab.github.io",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
];

const MAKSYMALNY_ROZMIAR_OCR = 1_000_000;
const LIMIT_CZASU_OCR_MS = 100_000;

function naglowkiCors(request) {
  const origin = request.headers.get("Origin");

  return {
    "Access-Control-Allow-Origin": DOZWOLONE_ORIGINS.includes(origin)
      ? origin
      : "https://andreutimofeev2008-collab.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function odpowiedz(dane, status, request) {
  return new Response(JSON.stringify(dane), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...naglowkiCors(request),
    },
  });
}

function slugify(tekst) {
  return tekst
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function base64Encode(tekst) {
  const bajty = new TextEncoder().encode(tekst);
  let binarny = "";

  const rozmiarFragmentu = 0x8000;

  for (let i = 0; i < bajty.length; i += rozmiarFragmentu) {
    binarny += String.fromCharCode(...bajty.subarray(i, i + rozmiarFragmentu));
  }

  return btoa(binarny);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: naglowkiCors(request),
      });
    }

    if (request.method !== "POST") {
      return odpowiedz(
        {
          error: "Endpoint obsługuje tylko metodę POST.",
        },
        405,
        request,
      );
    }

    try {
      /*
       * ============================
       * OCR
       * ============================
       */

      if (url.pathname === "/" || url.pathname === "/ocr") {
        const formularz = await request.formData();

        const plik = formularz.get("file");
        const jezyk = formularz.get("language") || "pol";

        if (!(plik instanceof File)) {
          return odpowiedz(
            {
              error: "Nie przesłano pliku.",
            },
            400,
            request,
          );
        }

        if (plik.size > MAKSYMALNY_ROZMIAR_OCR) {
          return odpowiedz(
            {
              error: `Obraz jest za duży (${(plik.size / 1_000_000).toFixed(2)} MB). OCR.space przyjmuje pliki do 1 MB. Zmniejsz obraz i spróbuj ponownie.`,
            },
            413,
            request,
          );
        }

        if (plik.type && !plik.type.startsWith("image/")) {
          return odpowiedz(
            { error: "Przesłany plik nie jest obrazem." },
            415,
            request,
          );
        }

        const dozwoloneJezyki = ["pol", "eng", "ger"];

        if (!dozwoloneJezyki.includes(jezyk)) {
          return odpowiedz(
            {
              error: "Nieprawidłowy język OCR.",
            },
            400,
            request,
          );
        }

        if (!env.OCRSPACE_API_KEY) {
          return odpowiedz(
            {
              error: "Brak konfiguracji OCRSPACE_API_KEY.",
            },
            500,
            request,
          );
        }

        const daneOCR = new FormData();

        daneOCR.append("apikey", env.OCRSPACE_API_KEY);
        daneOCR.append("language", jezyk);
        daneOCR.append("OCREngine", "3");
        daneOCR.append("isOverlayRequired", "false");
        daneOCR.append("file", plik);

        let odpowiedzOCR;

        try {
          odpowiedzOCR = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            body: daneOCR,
            signal: AbortSignal.timeout(LIMIT_CZASU_OCR_MS),
          });
        } catch (error) {
          const timeout = error?.name === "TimeoutError";

          return odpowiedz(
            {
              error: timeout
                ? "OCR.space zbyt długo przetwarzał obraz. Spróbuj ponownie albo wybierz mniejszy fragment strony."
                : "Nie udało się połączyć z OCR.space.",
              code: timeout ? "OCR_TIMEOUT" : "OCR_CONNECTION_ERROR",
              details: error instanceof Error ? error.message : String(error),
            },
            timeout ? 504 : 502,
            request,
          );
        }
        const wynikOCR = await odpowiedzOCR.json();

        if (!odpowiedzOCR.ok) {
          return odpowiedz(
            {
              error: "Błąd OCR.space.",
              details: wynikOCR,
            },
            502,
            request,
          );
        }

        return odpowiedz(
          {
            message: "OCR.space wynik:",
            result: wynikOCR,
          },
          200,
          request,
        );
      }

      /*
       * ============================
       * PUBLIKOWANIE NOTATKI
       * ============================
       */

      if (url.pathname === "/publish") {
        if (!env.GITHUB_TOKEN) {
          return odpowiedz(
            {
              error: "Brak sekretu GITHUB_TOKEN.",
            },
            500,
            request,
          );
        }

        if (!env.PUBLISH_SECRET) {
          return odpowiedz(
            {
              error: "Brak sekretu PUBLISH_SECRET.",
            },
            500,
            request,
          );
        }

        const dane = await request.json();

        const { tytul, przedmiot, temat, data, tresc, kodPublikacji } = dane;

        if (kodPublikacji !== env.PUBLISH_SECRET) {
          return odpowiedz(
            {
              error: "Nieprawidłowy kod publikacji.",
            },
            401,
            request,
          );
        }

        if (!tytul || !przedmiot || !temat || !data || !tresc) {
          return odpowiedz(
            {
              error: "Brakuje wymaganych danych notatki.",
            },
            400,
            request,
          );
        }

        const slugPrzedmiotu = slugify(przedmiot);
        const slugTytulu = slugify(tytul);

        if (!slugPrzedmiotu || !slugTytulu) {
          return odpowiedz(
            {
              error: "Nie można utworzyć poprawnej nazwy pliku.",
            },
            400,
            request,
          );
        }

        const sciezka = `src/content/notatki/${slugPrzedmiotu}/${slugTytulu}.md`;

        const bezpiecznyTekst = (tekst) => JSON.stringify(String(tekst));

        const markdown = `---
tytul: ${bezpiecznyTekst(tytul)}
przedmiot: ${bezpiecznyTekst(przedmiot)}
temat: ${bezpiecznyTekst(temat)}
data: ${data}
---

${tresc}
`;

        const githubUrl =
          `https://api.github.com/repos/` +
          `andreutimofeev2008-collab/Conspect/contents/` +
          `${sciezka}`;

        const odpowiedzGitHub = await fetch(githubUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "Conspect-Publisher",
          },
          body: JSON.stringify({
            message: `Dodaj notatkę: ${tytul}`,
            content: base64Encode(markdown),
            branch: "main",
          }),
        });

        const wynikGitHub = await odpowiedzGitHub.json();

        console.log("GitHub status:", odpowiedzGitHub.status);
        console.log("GitHub response:", wynikGitHub);

        if (!odpowiedzGitHub.ok) {
          if (odpowiedzGitHub.status === 422) {
            return odpowiedz(
              {
                error: "Notatka o takiej nazwie już istnieje.",
              },
              409,
              request,
            );
          }

          return odpowiedz(
            {
              error: "GitHub nie pozwolił opublikować notatki.",
              details: wynikGitHub,
            },
            502,
            request,
          );
        }

        return odpowiedz(
          {
            success: true,
            message: "Notatka została opublikowana na GitHubie.",
            path: sciezka,
          },
          201,
          request,
        );
      }

      /*
       * ============================
       * USUWANIE OPUBLIKOWANEJ NOTATKI
       * ============================
       */

      if (url.pathname === "/delete") {
        if (!env.GITHUB_TOKEN) {
          return odpowiedz(
            { error: "Brak sekretu GITHUB_TOKEN." },
            500,
            request,
          );
        }

        if (!env.PUBLISH_SECRET) {
          return odpowiedz(
            { error: "Brak sekretu PUBLISH_SECRET." },
            500,
            request,
          );
        }

        const { noteId, kodPublikacji } = await request.json();

        if (kodPublikacji !== env.PUBLISH_SECRET) {
          return odpowiedz(
            { error: "Nieprawidłowy kod publikacji." },
            401,
            request,
          );
        }

        if (
          typeof noteId !== "string" ||
          !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+$/.test(noteId)
        ) {
          return odpowiedz(
            { error: "Nieprawidłowy identyfikator notatki." },
            400,
            request,
          );
        }

        const segmenty = noteId.split("/");
        const sciezki = ["md", "mdx"].map((rozszerzenie) => {
          const ostatniSegment = segmenty.at(-1);
          segmenty[segmenty.length - 1] = `${ostatniSegment}.${rozszerzenie}`;
          const sciezka = `src/content/notatki/${segmenty.join("/")}`;
          segmenty[segmenty.length - 1] = ostatniSegment;
          return sciezka;
        });

        const headersGitHub = {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "Conspect-Publisher",
        };
        let plikDoUsuniecia = null;

        for (const sciezka of sciezki) {
          const odpowiedzGitHub = await fetch(
            `https://api.github.com/repos/andreutimofeev2008-collab/Conspect/contents/${sciezka
              .split("/")
              .map(encodeURIComponent)
              .join("/")}?ref=main`,
            { headers: headersGitHub },
          );

          if (odpowiedzGitHub.ok) {
            plikDoUsuniecia = { sciezka, dane: await odpowiedzGitHub.json() };
            break;
          }

          if (odpowiedzGitHub.status !== 404) {
            const szczegoly = await odpowiedzGitHub.json().catch(() => ({}));
            return odpowiedz(
              {
                error: "Nie udało się pobrać notatki z GitHuba.",
                details: szczegoly,
              },
              502,
              request,
            );
          }
        }

        if (!plikDoUsuniecia || typeof plikDoUsuniecia.dane.sha !== "string") {
          return odpowiedz(
            { error: "Nie znaleziono tej notatki w gałęzi main." },
            404,
            request,
          );
        }

        const odpowiedzGitHub = await fetch(
          `https://api.github.com/repos/andreutimofeev2008-collab/Conspect/contents/${plikDoUsuniecia.sciezka
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
          {
            method: "DELETE",
            headers: headersGitHub,
            body: JSON.stringify({
              message: `Usuń notatkę: ${plikDoUsuniecia.sciezka.split("/").at(-1)}`,
              sha: plikDoUsuniecia.dane.sha,
              branch: "main",
            }),
          },
        );
        const wynikGitHub = await odpowiedzGitHub.json().catch(() => ({}));

        if (!odpowiedzGitHub.ok) {
          return odpowiedz(
            {
              error: "GitHub nie pozwolił usunąć notatki.",
              details: wynikGitHub,
            },
            odpowiedzGitHub.status === 409 ? 409 : 502,
            request,
          );
        }

        return odpowiedz(
          {
            success: true,
            message: "Notatka została usunięta z gałęzi main.",
            path: plikDoUsuniecia.sciezka,
          },
          200,
          request,
        );
      }

      return odpowiedz(
        {
          error: "Nieznany endpoint.",
        },
        404,
        request,
      );
    } catch (error) {
      return odpowiedz(
        {
          error: "Wystąpił błąd serwera.",
          details: String(error),
        },
        500,
        request,
      );
    }
  },
};
