# Hard Copy

Every account opening starts with a document. A passport, a driving licence, a national ID. Before a bank trusts you, it has to read that document, decide it's genuine, and check the photo on it is actually you.

Hard Copy takes that apart, the same way Face Value took selfie matching apart. It's the second prototype on one identity pipeline, sharing the same engine underneath. The face work asked where a vision model fits in matching. This asks where it fits in documents, and I expect a different answer.

Here's the bet. On face matching the specialist model beat the vision model easily. On reading documents, messy layouts, many languages, faded print, I think the vision model wins. Same question, opposite result. That contrast is the point.

## What I'm testing

Three checks a bank actually runs, each measured against a cheaper specialist:

- Reading (extraction). Pull the fields, name, date of birth, document number, the machine-readable zone. Claude against a plain OCR engine, scored on how many characters and fields each gets right.
- Authenticity. Decide whether the document is genuine or tampered. Claude reasoning about it against a simple forensic baseline, scored on how many fakes slip through.
- Face-on-document match. Lift the photo off the document and match it to a selfie. This reuses the face engine from the first prototype, and it's harder than selfie-to-selfie, because a printed document photo is degraded.

## The documents

I generate them. Public ID datasets turned out to be the wrong tool: the standard ones are gated behind forms and SFTP, and the sizes are absurd for a small test (124GB for one, 490GB for another). For a few hundred documents, generating is cleaner and gives something the public sets can't: exact ground truth, because I wrote the fields myself.

A small generator builds ID cards from a synthetic face (the same DigiFace set as the face work), faker-made fields, and a valid machine-readable zone with correct check digits. Then it roughs them up like a phone photo, glare, blur, a little warp, so the reading test is honest. On pristine renders the OCR scores near-perfect and the vision model's real advantage never shows. For authenticity it makes tampered copies on purpose, swapped photos and edited dates, so every fake is labelled. No real person, no real document, seeded and reproducible.

The vision model only sees a small stratified subset of the documents, because each call costs money and time. Same cost discipline as the face work.

## The stack

Same engine as Face Value: the ONNX face model for the match, Claude through its command-line mode for the vision calls, and the same eval harness and cost accounting. Hard Copy is its own front end in burgundy on its own address, but the instrument is shared. One pipeline, two prototypes.

## What I expect, and why I'll check

The vision model reads better than the OCR baseline on messy documents, and earns less where the OCR already nails clean text. The economics decide where it belongs, the same lesson as the faces.

It catches obvious tampering and misses good forgeries, the way it caught obvious face spoofs and missed the good ones.

The document-to-selfie match needs a looser threshold than selfie-to-selfie. I'll report how much looser, and what it costs in wrongly-rejected genuine users.

Numbers come after the run. I'd rather show them once than guess them now.

## What this is not

Synthetic documents, simulated tampering, a prototype. The faces aren't real people and the forgeries aren't real fraud, so the numbers will show a method working, nothing more. There's a separate validation planned against an outside dataset, to see whether it holds up on documents I didn't make myself. The vocabulary is in the [Atlas](#atlas); the attack side is in the threat model.

## Where to look next

The [Atlas](#atlas) is the document vocabulary, written to be read. Try it out runs a document through the three checks. Results has the numbers, once the run lands.
