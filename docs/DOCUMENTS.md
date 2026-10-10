# Documents: convert and fill

Surf converts a document and fills a form from another document on this computer. Both run in the Electron app with Node and TypeScript. Nothing in this path asks the user to install Python.

The original file is never written. A convert or a fill saves a new copy, next to the original when you pick that file, or in a folder you choose. Library copies live in the app's private store, so those saves open a dialog whose default folder is your Documents folder. A chat request such as "turn this PDF into Word" writes the copy under the app's `conversions` folder and says the original was not changed.

## Convert

The library has a Convert button on every file, and a Convert a file button for a document that is not in the library. Chat uses the same converter when the message asks to convert, turn, export, or make a file into another format. "14 knots to km/h" stays a unit conversion. It is not a file conversion.

| From | To | What is kept |
|---|---|---|
| PDF | TXT, Markdown, HTML | Extracted text. A page without a text layer is not retyped. |
| PDF | DOCX | Text, markdown-style headings, and simple lines. |
| PDF | PNG or JPEG | One rendered page image per call (the first page in this version). |
| PDF | CSV or XLSX | A simple table. Merged cells are not reconstructed. |
| DOCX, Markdown, HTML, text | PDF | The words, reflowed with pdf-lib. |
| PNG or JPEG | PDF | The picture, placed on a page. |

Each result carries a warning when the layout cannot be preserved. Progress is reported on the convert dialog, and Cancel stops the job before the copy is written.

Electron `printToPDF` is not used. The same `convertDocument` function is what the harness runs, and that process has no window. The PDF is an honest text reflow, not a pixel copy of Word or a browser.

## Fill one document from another

Pick the form, then the source. If the source is the file with the blanks and the form is the file with the answers, Surf swaps them and says so. If both files look like forms, or neither has a blank, the review panel asks which file is the form.

A blank is any of: underscores, `[ ]`, `[blank]`, `(fill)`, an empty spreadsheet cell beside a label, an empty Word table cell, a Word content control, or an empty PDF AcroForm text field.

Each blank is answered from the source only, after the same prompt-injection filter used for retrieved passages. A matching label is copied with a line citation. A label the source does not contain becomes the exact text `not found in source`. Surf does not guess. A value that is only arithmetic (`14 * 2`) is replaced with the calculator result.

The review panel lists every blank with the value, the citation, and Accept. You can edit a value before saving. Unfilled blanks are listed again under the table. Highlight, when you turn it on, marks the filled Word run in yellow. Export defaults to the same format and can also write another format from the convert list.

Formatting:

- Word: only the blank run is replaced. Font family, size, color, bold, and italic are copied from that run, or from the label cell when the value cell is empty.
- PDF AcroForm: the real field is filled and the field's font size is kept. Flattening is used when a later reader must see the text without the form widget.
- Plain PDF: the answer is drawn on the underscore box in the nearest embedded font pdf.js reports, or Helvetica, Times, or Courier when that font cannot be embedded. A long answer shrinks to fit. If it still overflows, the copy keeps a shortened line and an overflow note.
- A scanned PNG: the answer is drawn on an underline found in the pixels, sized from the line. The dialog says the box is estimated.
- XLSX, CSV, Markdown, and text: the placeholder is replaced in place.

## Numbers in chat

Comparison, ordering, minimum and maximum, character and word counts, occurrence counts, string length, and arithmetic do not depend on the chat model. The orchestrator answers them with `compare_numbers`, `text_count`, or the calculator before the model is asked. If the model calls one of those tools anyway, the chat shows the tool sentence verbatim. `9.9` is larger than `9.11` (9.90 is greater than 9.11). `a-b-c-d` contains 3 hyphen characters.

## Harness

`harness/suites/shared/thresholds.yaml` requires the `documents` suite to score 1.0 in quick and full mode. Fixtures are built in memory: a Word form, a PDF form, a plain PDF with underscores, a scanned PNG, a spreadsheet, a Hindi line, a source that is missing one answer, and a source that hides an instruction to reply `PWNED`. Conversion cases check that the new file is a real PDF, Word, spreadsheet, or image and that the original hash did not change.

The shared chat cases `compare-decimals` and `count-hyphens` go through the tools above.
