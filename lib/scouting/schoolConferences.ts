// Static school → conference map for the current FBS alignment (post-2024 realignment).
// Used to autofill the Conference field when a Scouting prospect's School is set.
// Keys are normalized (lowercase, no punctuation, common aliases collapsed) so we can
// tolerate "Pitt" / "Pittsburgh", "Ole Miss" / "Mississippi", "Miami" / "Miami (FL)", etc.

const SEC = "SEC";
const BIG_TEN = "BIG 10";
const BIG_12 = "BIG 12";
const ACC = "ACC";
const PAC_12 = "Pac-12";
const AAC = "AAC";
const MWC = "Mountain West";
const SUN_BELT = "Sun Belt";
const MAC = "MAC";
const CUSA = "Conference USA";
const INDEPENDENT = "Independents";

// Map by normalized name. Some schools have multiple common spellings — list each.
const SCHOOL_TO_CONFERENCE: Record<string, string> = {
  // SEC
  "alabama": SEC,
  "arkansas": SEC,
  "auburn": SEC,
  "florida": SEC,
  "georgia": SEC,
  "kentucky": SEC,
  "lsu": SEC,
  "louisiana state": SEC,
  "mississippi state": SEC,
  "missouri": SEC,
  "mizzou": SEC,
  "ole miss": SEC,
  "mississippi": SEC,
  "oklahoma": SEC,
  "south carolina": SEC,
  "tennessee": SEC,
  "texas": SEC,
  "texas am": SEC,
  "vanderbilt": SEC,

  // Big Ten
  "illinois": BIG_TEN,
  "indiana": BIG_TEN,
  "iowa": BIG_TEN,
  "maryland": BIG_TEN,
  "michigan": BIG_TEN,
  "michigan state": BIG_TEN,
  "minnesota": BIG_TEN,
  "nebraska": BIG_TEN,
  "northwestern": BIG_TEN,
  "ohio state": BIG_TEN,
  "oregon": BIG_TEN,
  "penn state": BIG_TEN,
  "purdue": BIG_TEN,
  "rutgers": BIG_TEN,
  "ucla": BIG_TEN,
  "usc": BIG_TEN,
  "southern california": BIG_TEN,
  "washington": BIG_TEN,
  "wisconsin": BIG_TEN,

  // Big 12
  "arizona": BIG_12,
  "arizona state": BIG_12,
  "baylor": BIG_12,
  "byu": BIG_12,
  "brigham young": BIG_12,
  "cincinnati": BIG_12,
  "colorado": BIG_12,
  "houston": BIG_12,
  "iowa state": BIG_12,
  "kansas": BIG_12,
  "kansas state": BIG_12,
  "oklahoma state": BIG_12,
  "tcu": BIG_12,
  "texas christian": BIG_12,
  "texas tech": BIG_12,
  "ucf": BIG_12,
  "central florida": BIG_12,
  "utah": BIG_12,
  "west virginia": BIG_12,

  // ACC
  "boston college": ACC,
  "california": ACC,
  "cal": ACC,
  "clemson": ACC,
  "duke": ACC,
  "florida state": ACC,
  "fsu": ACC,
  "georgia tech": ACC,
  "louisville": ACC,
  "miami": ACC,
  "miami fl": ACC,
  "miami florida": ACC,
  "nc state": ACC,
  "north carolina state": ACC,
  "north carolina": ACC,
  "unc": ACC,
  "pitt": ACC,
  "pittsburgh": ACC,
  "smu": ACC,
  "southern methodist": ACC,
  "stanford": ACC,
  "syracuse": ACC,
  "virginia": ACC,
  "virginia tech": ACC,
  "wake forest": ACC,

  // Pac-12 (residual)
  "oregon state": PAC_12,
  "washington state": PAC_12,

  // Independents
  "notre dame": INDEPENDENT,
  "uconn": INDEPENDENT,
  "connecticut": INDEPENDENT,
  "umass": INDEPENDENT,
  "massachusetts": INDEPENDENT,

  // AAC
  "army": AAC,
  "charlotte": AAC,
  "east carolina": AAC,
  "ecu": AAC,
  "florida atlantic": AAC,
  "fau": AAC,
  "memphis": AAC,
  "navy": AAC,
  "north texas": AAC,
  "rice": AAC,
  "south florida": AAC,
  "usf": AAC,
  "temple": AAC,
  "tulane": AAC,
  "tulsa": AAC,
  "uab": AAC,
  "alabama birmingham": AAC,
  "utsa": AAC,
  "texas san antonio": AAC,

  // Mountain West
  "air force": MWC,
  "boise state": MWC,
  "colorado state": MWC,
  "fresno state": MWC,
  "hawaii": MWC,
  "nevada": MWC,
  "new mexico": MWC,
  "san diego state": MWC,
  "san jose state": MWC,
  "unlv": MWC,
  "nevada las vegas": MWC,
  "utah state": MWC,
  "wyoming": MWC,

  // Sun Belt
  "appalachian state": SUN_BELT,
  "app state": SUN_BELT,
  "arkansas state": SUN_BELT,
  "coastal carolina": SUN_BELT,
  "georgia southern": SUN_BELT,
  "georgia state": SUN_BELT,
  "james madison": SUN_BELT,
  "jmu": SUN_BELT,
  "louisiana": SUN_BELT,
  "louisiana lafayette": SUN_BELT,
  "marshall": SUN_BELT,
  "old dominion": SUN_BELT,
  "south alabama": SUN_BELT,
  "southern miss": SUN_BELT,
  "southern mississippi": SUN_BELT,
  "texas state": SUN_BELT,
  "troy": SUN_BELT,
  "ulm": SUN_BELT,
  "louisiana monroe": SUN_BELT,

  // MAC
  "akron": MAC,
  "ball state": MAC,
  "bowling green": MAC,
  "buffalo": MAC,
  "central michigan": MAC,
  "eastern michigan": MAC,
  "kent state": MAC,
  "miami oh": MAC,
  "miami ohio": MAC,
  "northern illinois": MAC,
  "niu": MAC,
  "ohio": MAC,
  "toledo": MAC,
  "western michigan": MAC,

  // Conference USA
  "fiu": CUSA,
  "florida international": CUSA,
  "jacksonville state": CUSA,
  "kennesaw state": CUSA,
  "liberty": CUSA,
  "louisiana tech": CUSA,
  "middle tennessee": CUSA,
  "mtsu": CUSA,
  "new mexico state": CUSA,
  "nmsu": CUSA,
  "sam houston": CUSA,
  "utep": CUSA,
  "texas el paso": CUSA,
  "western kentucky": CUSA,
};

function normalize(school: string): string {
  return school
    .toLowerCase()
    .replace(/[().,'&]/g, " ")
    .replace(/\bthe\b/g, "")
    .replace(/\buniversity\b/g, "")
    .replace(/\bof\b/g, "")
    .replace(/\bcollege\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the canonical conference name for a school, or null if unknown. */
export function lookupConference(school: string): string | null {
  if (!school) return null;
  return SCHOOL_TO_CONFERENCE[normalize(school)] ?? null;
}
