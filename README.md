# 🤖 AI Doodle Lab

**Draw it. Teach it. Test it.**

![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-4.22-ff6f00?logo=tensorflow&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

AI Doodle Lab is a kid-friendly, browser-based machine learning workshop where students teach an
AI to recognize their own drawings — and immediately test what it has learned.

<p align="center">
  <img src="docs/images/teach-stage.jpg" width="90%" alt="Teach stage: giving the AI a hand-drawn example of a cat" />
</p>

---

## ✨ What is it?

Kids go through a short, hands-on ML loop:

1. **Draw** an example (cat, house, or tree)
2. **Label** it
3. **Teach** the AI by adding it to the dataset
4. **Draw** something new
5. Let the **AI guess**
6. Turn mistakes into new training examples and try again

**Draw → Label → Teach → Test → Improve**

Along the way it demonstrates real machine learning ideas in a way that's tangible, not abstract:

- labeled training data
- classification
- dataset balance
- variation in examples
- model mistakes
- iterative improvement

## 🎮 How it works

The app has three stages:

### 1. Teach
Give the AI examples of cats, houses, and trees by drawing (or uploading) pictures and labeling them.

### 2. Challenge
Draw something new, unlabeled, and let the AI guess what it is — with real confidence scores. Got it
wrong? Turn that drawing into a new training example on the spot.

### 3. Learn
Friendly explainer cards cover *why* examples, dataset balance, and variation matter, plus a few
experiments to try live.

> The app uses **MobileNet** as a pretrained visual feature extractor and a **KNN classifier** for
> the workshop-specific categories. We are **not** training a complete neural network from scratch —
> MobileNet's weights are never modified.

<p align="center">
  <img src="docs/images/learn-stage.jpg" width="90%" alt="Learn stage: explainer cards about how the AI works" />
</p>

## 🚀 Run locally

```bash
git clone https://github.com/Drip1n/ai-doodle-lab.git
cd ai-doodle-lab
npm install
npm run dev
```

Then open the URL Vite prints (typically **http://localhost:5173**).

For a production build:

```bash
npm run build
npm run preview
```

## 📋 Requirements

- Node.js 18+
- npm
- A modern browser (Chrome, Firefox, Safari, Edge)

An internet connection is needed the first time the app loads, to download the MobileNet weights
(~17 MB) from Google's model host. The browser caches them after that, so subsequent loads work
offline.

## 🧠 Machine learning

- **TensorFlow.js** runs the model entirely client-side.
- **MobileNet** turns each drawing into a compact set of visual features (an embedding). It is used
  purely as a fixed feature extractor and is never retrained.
- A **KNN classifier** remembers the embeddings of the examples a student labels, then compares new
  drawings against them to make a prediction.
- Training examples and predictions never leave the browser.

```text
Drawing
   ↓
MobileNet
   ↓
Visual features
   ↓
KNN classifier
   ↓
Cat / House / Tree
```

## 🔒 Privacy

- No account required
- No analytics
- No tracking
- Drawings are processed locally in the browser
- Images are not uploaded to any server — everything (examples, predictions, dataset) is stored
  on-device via IndexedDB

## 🧑‍🏫 Workshop use

A suggested 10-minute activity for a classroom or booth:

1. Give each category (cat, house, tree) just 2 examples.
2. Test the AI in Challenge mode.
3. Observe where it gets confused.
4. Add more, more varied examples for the categories it struggled with.
5. Test again.
6. Discuss: what changed, and why?

> **Workshop question:** "What kind of data helped your AI improve?"

Facilitator notes:
- "Challenge success rate" reflects this session's challenges only — it isn't a model accuracy metric.
- Class names are editable (pencil icon on each card).
- **Reset AI** clears every example, name, and score, and asks for confirmation first.

## 🛠 Tech stack

- React 19
- TypeScript
- Vite
- TensorFlow.js
- MobileNet (`@tensorflow-models/mobilenet`)
- KNN Classifier (`@tensorflow-models/knn-classifier`)

## 📁 Project structure

```text
src/
  components/    UI: canvas, class cards, memory wall, challenge, learn cards, loader
  ml/            classifier.ts (MobileNet + KNN), imageProcessing.ts (shared 224x224 pipeline)
  hooks/         useAiLab.ts — all app state and actions
  storage/       db.ts — IndexedDB persistence
  styles/        base.css (tokens + primitives), app.css (components)
  types/         shared types and class definitions
```

## 🗺 Future ideas

These are possibilities, not existing features:

- custom categories
- webcam training
- team competitions
- save/export trained datasets
- teacher dashboard
- additional workshop modes

## 📄 License

[MIT](LICENSE)
