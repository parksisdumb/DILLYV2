// Step 2: Find the primary 10-K document URL for a given CIK
// Uses the submissions API primaryDocument field — no index page fetch needed.

const SEC_USER_AGENT = "Dilly/1.0 parks@sbdllc.co";

async function secFetch(url: string): Promise<Response> {
  await new Promise((r) => setTimeout(r, 200));
  return fetch(url, { headers: { "User-Agent": SEC_USER_AGENT } });
}

export async function get10KDocumentUrl(
  cik: string,
  companyName: string
): Promise<string | null> {
  const submUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const submResp = await secFetch(submUrl);

  if (!submResp.ok) {
    console.log(`[edgar-fetcher] ${companyName}: submissions fetch failed ${submResp.status}`);
    return null;
  }

  const submissions = (await submResp.json()) as {
    filings?: {
      recent?: {
        form?: string[];
        accessionNumber?: string[];
        primaryDocument?: string[];
        filingDate?: string[];
      };
    };
  };

  const forms = submissions.filings?.recent?.form ?? [];
  const accessions = submissions.filings?.recent?.accessionNumber ?? [];
  const primaryDocs = submissions.filings?.recent?.primaryDocument ?? [];

  let tenKIndex = -1;
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === "10-K") {
      tenKIndex = i;
      break;
    }
  }

  if (tenKIndex === -1) {
    console.log(`[edgar-fetcher] ${companyName}: no 10-K found in ${forms.length} filings`);
    return null;
  }

  const accession = accessions[tenKIndex];
  const primaryDoc = primaryDocs[tenKIndex];

  if (!accession) {
    console.log(`[edgar-fetcher] ${companyName}: 10-K at index ${tenKIndex} but no accession`);
    return null;
  }

  if (!primaryDoc) {
    console.log(`[edgar-fetcher] ${companyName}: 10-K at index ${tenKIndex} but no primaryDocument`);
    return null;
  }

  const accessionNoDashes = accession.replace(/-/g, "");
  const cikNum = parseInt(cik, 10);
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDashes}/${primaryDoc}`;

  console.log(`[edgar-fetcher] ${companyName}: found 10-K: ${primaryDoc}`);
  return docUrl;
}
