# Importing your course materials from Moodle

TutorAI can connect to your institution's Moodle, show your courses, and import the files you choose, so you don't have to download and upload them one by one. It works in **TutorAI installed on your computer** (not on the website), and today at **Reichman University**.

## How it works

1. On the home page press **Import from Moodle** and pick your institution.
2. Press **Sign in to Moodle**. Your institution's normal sign-in page opens in a new tab. Sign in as you always do.
3. Come back to TutorAI:
   - On a Mac, your browser asks whether to open TutorAI. Allow it, and you're connected.
   - Otherwise, the Moodle page shows one link in a box. Right-click it, choose **Copy Link Address**, and paste it into TutorAI.
4. Pick the courses to bring in. For each course you see its files, already ticked. Untick what you don't want and press **Import**.

Later, when you open a course's Materials tab, TutorAI checks Moodle and tells you if there are new files. It never downloads or analyzes anything until you press Import.

## What TutorAI can and cannot see

- It can **read** the list of your courses and the files in them, with your own account: exactly what you can see in Moodle yourself.
- It **never changes anything** in Moodle: no submissions, no posts, no marks.
- It **never sees your password**. You type it on your institution's page, not in TutorAI.
- Your files stay on your computer, in your TutorAI folder, like files you upload by hand. Nothing is shared with other students, and there is no TutorAI server.

## Where the connection is kept

After you sign in, Moodle gives TutorAI a key (a "token") for your account. It is kept in a private file on your computer (`~/.tutorai/moodle`), not in your browser and not in your TutorAI data folder, so backing up or syncing that folder never copies it.

The key is the same one the Moodle app on your phone uses. Your institution limits how long it lasts, usually about 12 weeks, and it may have started before you connected TutorAI. When it ends, TutorAI says so and you sign in again with one button. Your courses and imported files are not affected.

## Disconnecting

**Settings → Data → Moodle → Disconnect** deletes the key from your computer. To cancel the key in Moodle itself as well, open Moodle → your profile → Preferences → **Security keys** → Reset. That also signs out the Moodle app on your phone, because it is the same key.

## What can't be imported

- Lecture recordings and external tools (Zoom, Panopto and similar).
- Quizzes, forums and assignments themselves.
- Text written directly in Moodle pages (planned).
- Files that aren't PDF, PowerPoint (PPTX), Word (DOCX) or text, and files over 60 MB.

TutorAI tells you how many of these it found in a course.

## Other institutions

Only Reichman is supported today. Whether another institution can be added depends on its Moodle: it must allow apps to connect (Moodle's "mobile service"). Some institutions have that turned off, and there TutorAI cannot connect; you can still upload files by hand. The survey of Israeli institutions is in [rfc-moodle.md](rfc-moodle.md#appendix-a-institutions).
