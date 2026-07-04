# Hard Copy

Every account opening starts with a document. A passport, a driving licence, a national ID. Before a bank trusts you, it has to read that document, decide it's genuine, and check the photo on it is actually you.

"Hard Copy" takes that apart, the same way "Face Value" took selfie matching apart. It's the second prototype on one identity pipeline, sharing the same engine underneath. The face work asked where a vision model fits in matching. This asks where it fits in documents, and I expect a different answer.

Here's the bet. On face matching the specialist model beat the vision model easily. On reading documents, messy layouts, many languages, faded print, I think the vision model wins. Same question, opposite result. That contrast is the point.

## What I'm testing

Three checks a bank actually runs, each measured against a cheaper specialist:

- Reading (extraction). Pull the fields, name, date of birth, document number, the machine-readable zone. Claude against a plain OCR engine, scored on how many characters and fields each gets right.
- Authenticity. Decide whether the document is genuine or tampered. Claude reasoning about it against a simple forensic baseline, scored on how many fakes slip through.
- Face-on-document match. Lift the photo off the document and match it to a selfie. This reuses the face engine from the first prototype, and it's harder than selfie-to-selfie, because a printed document photo is degraded.

## The documents

I generate them. The public ID datasets are either gated behind forms or huge (one is 124GB, another 490GB), which is overkill for a few hundred documents. Generating is simpler, and it gives me exact ground truth, since I wrote the fields.

A small script builds ID cards: a synthetic face (the same DigiFace set as the face work), fake fields, and a valid machine-readable zone. Then it roughs them up like a phone photo so the reading test is fair. For authenticity it tampers copies on purpose, swapped photos, edited dates, so every fake is labelled. No real people, no real documents, all seeded. The vision model only sees a small subset of these, since each call costs money and time.

The one exception is the authenticity re-run, which uses SIDTD, a public dataset of real ID templates and forgeries (CC BY-SA 2.5). That's the only place the documents aren't mine. It's reported separately in Results.

## The stack

Same engine as "Face Value": the ONNX face model for the match, Claude via its command-line interface for the vision calls, and the same eval harness and cost accounting. The extraction baseline is Tesseract 5, run against the whole document with no field cropping, deliberately the weak form, since a real OCR pipeline would crop each field first. "Hard Copy" is its own front end in burgundy on its own address, but the instrument underneath is shared. One pipeline, two prototypes.

## What it found

Every bet landed, and the most useful result is the one that got worse.

Reading: the vision model read the documents almost perfectly, a character error rate of 0.2% with 98% of fields exact, and far ahead of a plain OCR baseline. Honest caveat: that baseline wasn't given cropped field regions the way a production OCR pipeline would be, so read the size of the gap as directional rather than final. The real point holds. A vision model reads raw, messy documents with no per-template plumbing.

A bigger caveat, worth saying out loud. This comparison was against a plain OCR baseline. It was not against a real IDV product, and it wouldn't win if it were. The specialist vendors banks actually use are years ahead on forgery: template libraries, hologram and UV checks, MRZ cross-checks, injection detection, and fraud intelligence that keeps up as new attacks appear. Nothing here competes with that, and I'm not claiming it does. The narrow finding is that a generalist model reads and reasons about documents surprisingly well with no bespoke pipeline. Read it as a look at where these models might help inside a real system, rather than a replacement for one.

Authenticity is where it gets interesting, and where I'm being careful. On my own synthetic forgeries the model scored a perfect AUC of 1.0, which should worry you more than please you: those forgeries were too easy. So I re-ran it on real ID-document forgeries (SIDTD, ten tampering types including photo substitution, field overwrite, and font changes). It flagged every one. Encouraging, but I won't oversell it: the sample was small, 40 documents with only a couple per tampering type, and several of those "types" are image edits like rotation or blur rather than real fraud, so the genuine-fraud signal rests on a handful of examples. A perfect score here means "look closer," not "solved." A bigger run, weighted to the real fraud types, is what turns this into a number I'd stand behind.

Face-on-document match: the document photo needs a looser threshold than a selfie, 0.25 against 0.28, with an equal-error rate around 3%. The gap is real but modest here, because my printed-card photo isn't badly degraded. A real scan-and-reprint would push it further.

The whole thing, both runs, cost about $3.50 in model calls.

## What this is not

Synthetic documents, simulated tampering, a prototype. The faces aren't real people and my own forgeries aren't real fraud, so the numbers show a method working, nothing more. I did test authenticity on real ID-document forgeries (SIDTD), and the model flagged all of them, but on a sample too small to publish a rate, so I read it as encouraging rather than proven. Extraction and face-match haven't been tested outside my own documents. The vocabulary is in the [Atlas](#atlas); the attack side is in the threat model.

## Where to look next

The [Atlas](#atlas) is the document vocabulary, written to be read. Try it out runs a document through the three checks. Results has the numbers, once the run lands.
