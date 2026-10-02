// Messy-speech corpus for the LLM cleanup E2E test. Each fixture is dictated speech (TTS: System.Speech
// for English, Piper for German) with the text a good cleanup should produce.
//
// Failure modes each fixture targets (written before the cleanup code, see planning/decisions.md):
//  C1  an already clean sentence is damaged (words changed or dropped)
//  C2  fillers, repetitions, stutters or spoken punctuation words stay in
//  C3  a self-correction is not resolved, or "actually"/"eigentlich" as emphasis is treated as one
//  C4  a question in the dictation is answered
//  C5  an instruction in the dictation is followed ("write an email to ...")
//  C6  German is translated to English or the other way round
//  C7  a preamble, quotes, think blocks or tags are added
//  C8  numbers, dates, times or amounts change
//  C9  dictionary / on-screen terms and names are broken
//  C10 text is invented from filler-only input
//  C11 prose is turned into a list, or a clearly spoken list is ignored
//  C12 the app style is ignored (chat vs professional)
//  C13 cleanup is too slow, or a broken runtime blocks insertion
//  C14 English tech terms inside German sentences are "corrected"
//  C15 text before the cursor is ignored: a continued sentence gets a capital letter, a name already
//      typed there is misspelled
//  C16 text before the cursor is repeated, edited or answered
import { type CleanupStyle } from "../../src/shared/cleanup-prompt";
import { type FixtureSpec, type Part, type SpeechLanguage } from "../e2e-dictation/corpus";

export interface CleanupFixtureSpec extends FixtureSpec {
  lang: SpeechLanguage;
  style: CleanupStyle;
  /** What a good cleanup produces. Empty means the dictation was only filler. */
  expected: string;
  /** Dictionary / on-screen terms: sent to Whisper as prompt and to the cleanup as preferred spellings. */
  terms?: string[];
  /** Must not appear in the cleaned text (case-insensitive, whole words). */
  mustNotContain?: string[];
  /** Regex (multiline) the cleaned text must match. */
  mustMatch?: string;
  /** Regex (multiline) the cleaned text must not match. */
  mustNotMatch?: string;
  /** Text already typed before the cursor in the target app (cursor context). */
  before?: string;
}

const LIST = "(^|\\n)\\s*(1\\.|-|•)\\s";
const NUMBERED = "(^|\\n)1\\. .+\\n2\\. ";

const say = (lang: SpeechLanguage, ...sentences: string[]): Part[] =>
  sentences.flatMap((text, index): Part[] => [
    ...(index > 0 ? [{ kind: "pause", ms: 500 } as const] : []),
    { kind: "speech", text, lang, voice: index % 2 }
  ]);

type Spec = Omit<CleanupFixtureSpec, "expectSpeech" | "parts" | "promptTerms"> & { spoken: string[] };

const specs: Spec[] = [
  // ---------- English ----------
  {
    id: "en-clean", lang: "en", style: "default", targets: ["C1"], maxWer: 0.1,
    spoken: ["Please send the updated report to the whole team before the meeting starts."],
    expected: "Please send the updated report to the whole team before the meeting starts."
  },
  {
    id: "en-fillers", lang: "en", style: "default", targets: ["C2"], maxWer: 0.2,
    spoken: ["Um, so, I think, uh, I think we should probably move the release to next week."],
    expected: "So I think we should probably move the release to next week.",
    mustNotContain: ["um", "uh"], mustNotMatch: "I think,? I think"
  },
  {
    id: "en-no-wait", lang: "en", style: "default", targets: ["C3"], maxWer: 0.25,
    spoken: ["Let's meet on Thursday at ten, no wait, on Friday at ten."],
    expected: "Let's meet on Friday at 10.",
    mustContain: ["Friday"], mustNotContain: ["Thursday", "no wait"]
  },
  {
    id: "en-scratch-that", lang: "en", style: "default", targets: ["C3"], maxWer: 0.4,
    spoken: ["Send the invoice to Peter.", "Scratch that, send it to Maria."],
    expected: "Send the invoice to Maria.",
    mustContain: ["Maria"], mustNotContain: ["Peter", "scratch that"]
  },
  {
    id: "en-actually", lang: "en", style: "default", targets: ["C3", "C1"], maxWer: 0.1,
    spoken: ["I actually think the new design looks great."],
    expected: "I actually think the new design looks great.",
    mustContain: ["actually"]
  },
  {
    id: "en-question", lang: "en", style: "default", targets: ["C4"], maxWer: 0.1,
    spoken: ["What is the capital of Australia?"],
    expected: "What is the capital of Australia?",
    mustNotContain: ["Canberra"]
  },
  {
    id: "en-instruction", lang: "en", style: "default", targets: ["C5", "C7"], maxWer: 0.1,
    spoken: ["Write an email to Bob and tell him the server is down."],
    expected: "Write an email to Bob and tell him the server is down.",
    mustNotContain: ["Dear", "Subject", "Hi Bob"]
  },
  {
    id: "en-list", lang: "en", style: "default", targets: ["C11"], maxWer: 0.25,
    spoken: ["The steps are, first, install the app, second, open the settings, and third, restart the computer."],
    expected: "The steps are:\n1. Install the app\n2. Open the settings\n3. Restart the computer",
    mustMatch: LIST
  },
  {
    id: "en-prose", lang: "en", style: "default", targets: ["C11", "C1"], maxWer: 0.1,
    spoken: ["We need milk, bread and some coffee for the office."],
    expected: "We need milk, bread and some coffee for the office.",
    mustNotMatch: LIST
  },
  {
    // Numbered answers to someone's questions: each point is a whole sentence, there is no intro.
    id: "en-answer-list", lang: "en", style: "default", targets: ["C11"], maxWer: 0.25,
    spoken: ["First, yes, the new laptop can be ordered this week. Second, no, the old monitors stay in the office."],
    expected: "1. Yes, the new laptop can be ordered this week.\n2. No, the old monitors stay in the office.",
    mustMatch: NUMBERED
  },
  {
    id: "en-first-prose", lang: "en", style: "default", targets: ["C11", "C1"], maxWer: 0.1,
    spoken: ["First we have lunch, and then we look at the budget together."],
    expected: "First we have lunch, and then we look at the budget together.",
    mustNotMatch: LIST
  },
  {
    id: "en-numbers", lang: "en", style: "default", targets: ["C8"], maxWer: 0.5,
    spoken: ["The workshop is on March the third at two thirty and costs four hundred and fifty euros."],
    expected: "The workshop is on March 3rd at 2:30 and costs 450 euros.",
    mustMatch: "(450|four hundred and fifty)", mustNotMatch: "\\b(2025|2026|500|400)\\b"
  },
  {
    id: "en-terms", lang: "en", style: "default", targets: ["C9"], maxWer: 0.1,
    spoken: ["Open VoxType and select the Parakeet model in the settings."],
    terms: ["VoxType", "Parakeet", "Silero"],
    expected: "Open VoxType and select the Parakeet model in the settings.",
    mustContain: ["VoxType", "Parakeet"]
  },
  {
    id: "en-filler-only", lang: "en", style: "default", targets: ["C10"], maxWer: 0,
    spoken: ["Um.", "Uh.", "Hmm."],
    expected: ""
  },
  {
    // Whisper mishears "I think" as "the first think" here; the threshold allows for that ASR error.
    id: "en-spoken-punct", lang: "en", style: "default", targets: ["C2"], maxWer: 0.35,
    spoken: ["Can you check the logs question mark I think the job failed period"],
    expected: "Can you check the logs? I think the job failed.",
    mustNotContain: ["question mark", "period"], mustMatch: "logs\\?"
  },
  {
    id: "en-chat", lang: "en", style: "chat", targets: ["C12"], maxWer: 0.1,
    spoken: ["Sounds good, see you tomorrow."],
    expected: "Sounds good, see you tomorrow",
    mustNotMatch: "\\.\\s*$"
  },
  {
    id: "en-professional", lang: "en", style: "professional", targets: ["C12", "C2"], maxWer: 0.2,
    spoken: ["Hi Sarah comma new paragraph thanks for the update period I will review the contract by Friday period new paragraph best regards Martin"],
    expected: "Hi Sarah,\n\nThanks for the update. I will review the contract by Friday.\n\nBest regards,\nMartin",
    // Whisper hears "Sara" or "Sarah" depending on the run; the spelling is not the cleanup's job.
    mustMatch: "Sarah?,\\s*\\n", mustNotContain: ["comma", "new paragraph", "period"]
  },
  {
    id: "en-long", lang: "en", style: "default", targets: ["C13", "C2", "C1"], maxWer: 0.15,
    spoken: [
      "Okay, so, um, here is the update for the weekly planning call.",
      "The design team finished the new onboarding screens and, uh, they are ready for review.",
      "Engineering is still working on the performance problems in the search feature.",
      "Support reported that several customers could not export their data on Friday, so we should, um, we should prioritize that problem because it blocks important workflows.",
      "Marketing would like to announce the new features at the end of the month.",
      "Please add your comments to the shared document before tomorrow afternoon."
    ],
    expected:
      "Okay, so here is the update for the weekly planning call. The design team finished the new onboarding screens and they are ready for review. Engineering is still working on the performance problems in the search feature. Support reported that several customers could not export their data on Friday, so we should prioritize that problem because it blocks important workflows. Marketing would like to announce the new features at the end of the month. Please add your comments to the shared document before tomorrow afternoon.",
    mustNotContain: ["um", "uh"]
  },

  {
    id: "en-continue", lang: "en", style: "default", targets: ["C15", "C16"], maxWer: 0.15,
    before: "Thanks for the quick reply. I will send the report",
    spoken: ["to the whole team tomorrow morning."],
    expected: "to the whole team tomorrow morning.",
    mustMatch: "^to the whole team", mustNotContain: ["Thanks for the quick reply"]
  },
  {
    id: "en-context-name", lang: "en", style: "default", targets: ["C15"], maxWer: 0.2,
    before: "Attendees: Anna Kowalczyk, Ravi Raghunathan.\n\n",
    spoken: ["Please forward the minutes to Ravi Ragunatan."],
    expected: "Please forward the minutes to Ravi Raghunathan.",
    mustContain: ["Raghunathan"], mustNotContain: ["Attendees", "Kowalczyk"]
  },
  {
    id: "en-context-question", lang: "en", style: "default", targets: ["C16", "C4"], maxWer: 0.1,
    before: "Q: Which port does the staging server use?\nA: ",
    spoken: ["I am not sure, let me check with Tom."],
    expected: "I am not sure, let me check with Tom.",
    mustNotMatch: "\\d"
  },

  // ---------- German ----------
  {
    id: "de-clean", lang: "de", style: "default", targets: ["C1", "C6"], maxWer: 0.1,
    spoken: ["Bitte schick den aktualisierten Bericht vor dem Meeting an das ganze Team."],
    expected: "Bitte schick den aktualisierten Bericht vor dem Meeting an das ganze Team."
  },
  {
    id: "de-fillers", lang: "de", style: "default", targets: ["C2"], maxWer: 0.2,
    spoken: ["Ähm, also, ich glaube, äh, ich glaube, wir sollten das Release auf nächste Woche verschieben."],
    expected: "Also, ich glaube, wir sollten das Release auf nächste Woche verschieben.",
    mustNotContain: ["ähm", "äh"], mustNotMatch: "ich glaube,? ich glaube"
  },
  {
    id: "de-nein-warte", lang: "de", style: "default", targets: ["C3"], maxWer: 0.3,
    spoken: ["Lass uns den Termin am Donnerstag um zehn machen, nein warte, am Freitag um zehn."],
    expected: "Lass uns den Termin am Freitag um 10 machen.",
    mustContain: ["Freitag"], mustNotContain: ["Donnerstag", "nein warte"]
  },
  {
    // Whisper hears "Rechnung" as "Rechten"; "an" may close either clause.
    id: "de-ich-meine", lang: "de", style: "default", targets: ["C3"], maxWer: 0.4,
    spoken: ["Ruf bitte Herrn Becker an, ich meine Herrn Schneider, wegen der Rechnung."],
    expected: "Ruf bitte Herrn Schneider wegen der Rechnung an.",
    mustContain: ["Schneider"], mustNotContain: ["Becker", "ich meine"]
  },
  {
    id: "de-eigentlich", lang: "de", style: "default", targets: ["C3", "C1"], maxWer: 0.1,
    spoken: ["Ich finde das neue Design eigentlich ziemlich gut."],
    expected: "Ich finde das neue Design eigentlich ziemlich gut.",
    mustContain: ["eigentlich"]
  },
  {
    id: "de-question", lang: "de", style: "default", targets: ["C4"], maxWer: 0.1,
    spoken: ["Wie spät ist es gerade in Tokio?"],
    expected: "Wie spät ist es gerade in Tokio?",
    mustNotMatch: "\\d"
  },
  {
    id: "de-instruction", lang: "de", style: "default", targets: ["C5", "C7"], maxWer: 0.15,
    spoken: ["Schreib eine E-Mail an Thomas und sag ihm, dass der Server nicht erreichbar ist."],
    expected: "Schreib eine E-Mail an Thomas und sag ihm, dass der Server nicht erreichbar ist.",
    mustNotContain: ["Hallo Thomas", "Betreff", "Lieber Thomas"]
  },
  {
    id: "de-mixed-terms", lang: "de", style: "default", targets: ["C6", "C14", "C9"], maxWer: 0.15,
    spoken: ["Wir müssen das Deployment auf Kubernetes noch einmal testen, weil der Health Check fehlschlägt."],
    terms: ["Kubernetes"],
    expected: "Wir müssen das Deployment auf Kubernetes noch einmal testen, weil der Health Check fehlschlägt.",
    mustContain: ["Deployment", "Kubernetes"], mustNotContain: ["Bereitstellung", "Gesundheitsprüfung", "we need"]
  },
  {
    id: "de-pull-request", lang: "de", style: "default", targets: ["C14", "C6"], maxWer: 0.2,
    spoken: ["Kannst du den Pull Request reviewen, bevor wir den Branch mergen?"],
    expected: "Kannst du den Pull Request reviewen, bevor wir den Branch mergen?",
    mustNotContain: ["Zusammenführungsanfrage", "Zweig", "can you"]
  },
  {
    id: "de-list", lang: "de", style: "default", targets: ["C11"], maxWer: 0.3,
    spoken: ["Für morgen brauche ich erstens den Bericht, zweitens die Präsentation und drittens die Zahlen."],
    expected: "Für morgen brauche ich:\n1. den Bericht\n2. die Präsentation\n3. die Zahlen",
    mustMatch: LIST
  },
  {
    id: "de-prose", lang: "de", style: "default", targets: ["C11", "C1"], maxWer: 0.1,
    spoken: ["Wir brauchen noch Milch, Brot und etwas Kaffee für das Büro."],
    expected: "Wir brauchen noch Milch, Brot und etwas Kaffee für das Büro.",
    mustNotMatch: LIST
  },
  {
    id: "de-answer-list", lang: "de", style: "default", targets: ["C11"], maxWer: 0.3,
    spoken: ["Erstens, ja, der Vertrag kann so raus. Zweitens, nein, den Termin am Freitag verschieben wir nicht."],
    expected: "1. Ja, der Vertrag kann so raus.\n2. Nein, den Termin am Freitag verschieben wir nicht.",
    mustMatch: NUMBERED
  },
  {
    id: "de-numbers", lang: "de", style: "default", targets: ["C8"], maxWer: 0.5,
    spoken: ["Die Rechnung über dreihundertvierzig Euro ist am fünfzehnten Mai fällig."],
    expected: "Die Rechnung über 340 Euro ist am 15. Mai fällig.",
    mustMatch: "(340|dreihundertvierzig)", mustNotMatch: "\\b(2025|2026|300|400)\\b"
  },
  {
    id: "de-terms", lang: "de", style: "default", targets: ["C9"], maxWer: 0.15,
    spoken: ["Bitte leg im SAP einen neuen Kundenauftrag für die Firma Müller an."],
    terms: ["Kundenauftrag", "SAP"],
    expected: "Bitte leg im SAP einen neuen Kundenauftrag für die Firma Müller an.",
    mustContain: ["Kundenauftrag", "SAP", "Müller"]
  },
  {
    id: "de-filler-only", lang: "de", style: "default", targets: ["C10"], maxWer: 0,
    spoken: ["Ähm.", "Äh.", "Hm."],
    expected: "",
    knownIssue: "Whisper hears the Piper voice's German hesitation sounds as words (\"Bein. Ja.\"); cleanup cannot tell them from speech"
  },
  {
    id: "de-spoken-punct", lang: "de", style: "default", targets: ["C2"], maxWer: 0.15,
    spoken: ["Kannst du mir die Datei schicken Fragezeichen Danke Ausrufezeichen"],
    expected: "Kannst du mir die Datei schicken? Danke!",
    mustNotContain: ["Fragezeichen", "Ausrufezeichen"], mustMatch: "schicken\\?"
  },
  {
    id: "de-chat", lang: "de", style: "chat", targets: ["C12"], maxWer: 0.1,
    spoken: ["Klingt gut, bis morgen."],
    expected: "Klingt gut, bis morgen",
    mustNotMatch: "\\.\\s*$"
  },
  {
    id: "de-professional", lang: "de", style: "professional", targets: ["C12", "C2"], maxWer: 0.25,
    spoken: ["Sehr geehrte Frau Weber Komma neuer Absatz vielen Dank für Ihre Nachricht Punkt Ich melde mich bis Freitag bei Ihnen Punkt neuer Absatz Mit freundlichen Grüßen Martin"],
    expected: "Sehr geehrte Frau Weber,\n\nvielen Dank für Ihre Nachricht. Ich melde mich bis Freitag bei Ihnen.\n\nMit freundlichen Grüßen\nMartin",
    mustMatch: "Weber,\\s*\\n", mustNotContain: ["Komma", "neuer Absatz", "Punkt"]
  },
  {
    id: "de-continue", lang: "de", style: "default", targets: ["C15", "C16"], maxWer: 0.15,
    before: "Hallo Jonas, kurze Info: Ich habe die Unterlagen gestern",
    spoken: ["an den Kunden geschickt und warte jetzt auf seine Antwort."],
    expected: "an den Kunden geschickt und warte jetzt auf seine Antwort.",
    mustMatch: "^an den Kunden", mustNotContain: ["Hallo Jonas"]
  },
  {
    id: "de-context-name", lang: "de", style: "default", targets: ["C15"], maxWer: 0.2,
    before: "Ansprechpartner beim Kunden: Herr Brzezinski (Einkauf).\n\n",
    spoken: ["Bitte ruf morgen Herrn Bschesinski wegen der Lieferung an."],
    expected: "Bitte ruf morgen Herrn Brzezinski wegen der Lieferung an.",
    mustContain: ["Brzezinski"], mustNotContain: ["Ansprechpartner", "Einkauf"]
  },
  {
    id: "de-long", lang: "de", style: "default", targets: ["C13", "C2", "C1"], maxWer: 0.2,
    spoken: [
      "Also, ähm, kurz zum Stand vom Projekt.",
      "Das Designteam hat die neuen Bildschirme für das Onboarding fertig, und, äh, die können jetzt geprüft werden.",
      "Die Entwicklung arbeitet noch an den Performanceproblemen in der Suche.",
      "Der Support hat gemeldet, dass mehrere Kunden am Freitag ihre Daten nicht exportieren konnten, deshalb sollten wir, ähm, deshalb sollten wir das zuerst lösen.",
      "Bitte tragt eure Kommentare bis morgen Nachmittag in das gemeinsame Dokument ein."
    ],
    expected:
      "Also, kurz zum Stand vom Projekt. Das Designteam hat die neuen Bildschirme für das Onboarding fertig, und die können jetzt geprüft werden. Die Entwicklung arbeitet noch an den Performanceproblemen in der Suche. Der Support hat gemeldet, dass mehrere Kunden am Freitag ihre Daten nicht exportieren konnten, deshalb sollten wir das zuerst lösen. Bitte tragt eure Kommentare bis morgen Nachmittag in das gemeinsame Dokument ein.",
    mustNotContain: ["ähm", "äh"]
  }
];

export const CLEANUP_FIXTURES: CleanupFixtureSpec[] = specs.map(({ spoken, ...spec }) => ({
  ...spec,
  parts: say(spec.lang, ...spoken),
  promptTerms: spec.terms,
  expectSpeech: true
}));
