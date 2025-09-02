/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, Modality} from '@google/genai';
import {marked} from 'marked';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

const appContainer = document.querySelector('.app-container') as HTMLDivElement;
const userInput = document.querySelector('#input') as HTMLTextAreaElement;
const generateBtn = document.querySelector('#generate-btn') as HTMLButtonElement;
const modelOutput = document.querySelector('#output') as HTMLDivElement;
const slideshow = document.querySelector('#slideshow') as HTMLDivElement;
const error = document.querySelector('#error') as HTMLDivElement;
const actionsContainer = document.querySelector(
  '#actions-container',
) as HTMLDivElement;
const downloadBtn = document.querySelector('#download-btn') as HTMLButtonElement;
const copyTextBtn = document.querySelector(
  '#copy-text-btn',
) as HTMLButtonElement;
const shareBtn = document.querySelector('#share-btn') as HTMLButtonElement;
const reelBtn = document.querySelector('#reel-btn') as HTMLButtonElement;
const reelShareBtn = document.querySelector(
  '#reel-share-btn',
) as HTMLButtonElement;
const themeSelector = document.querySelector('#theme-selector') as HTMLUListElement;
const ratioSelector = document.querySelector('#ratio-selector') as HTMLUListElement;
const colorSelector = document.querySelector('#color-selector') as HTMLUListElement;


let selectedTheme = 'cats';
let selectedRatio = '1-1';
let selectedColorStyle = 'bw';


// --- IndexedDB Configuration and Helpers ---
const DB_NAME = 'SlideshowDB';
const DB_VERSION = 1;
const STORE_NAME = 'slideshowStore';
const SLIDESHOW_KEY = 'currentSlideshow';

interface SavedSlide {
  isQuestion: boolean;
  text: string;
  imageBlob: Blob | null;
}

interface SavedSlideshow {
  question: string;
  theme: string;
  ratio: string;
  colorStyle: string;
  slides: SavedSlide[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function saveDataToDB(key: string, value: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put(value, key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDataFromDB<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function clearDataFromDB(key: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

// --- End of IndexedDB Helpers ---

const THEME_INSTRUCTIONS = {
  cats: 'Use a fun story about lots of cats as a metaphor.',
  robots: 'Use a story about happy robots as a metaphor.',
  trees: 'Use a story about wise old trees as a metaphor.',
  gnomes: 'Use a story about busy gnomes as a metaphor.',
  doodles:
    'Use a fun story told through simple, hand-drawn doodles as a metaphor.',
  humans: 'Use a simple story about everyday people as a metaphor.',
  element:
    'Use a story about the classical elements (earth, water, air, fire) as a metaphor.',
};

const COLOR_STYLE_INSTRUCTIONS = {
  bw: 'with black ink on a white background.',
  muted: 'using a muted, vintage color palette.',
  vibrant: 'using a vibrant and playful color palette.',
  pastel: 'using a soft pastel color palette.',
  duotone: 'using a stylish blue and orange duotone color palette.',
};

const commonInstructionsPart1 = `
Keep sentences short but conversational, casual, and engaging.
Generate a cute, minimal illustration for each sentence `;

const commonInstructionsPart2 = ` The main subject should be very large and fill almost the entire image canvas.
No commentary, just begin your explanation.
Keep going until you're done, aiming for around 10-15 slides to fully explain the topic.`;

function getAdditionalInstructions(): string {
  const colorInstruction =
    COLOR_STYLE_INSTRUCTIONS[selectedColorStyle] ||
    COLOR_STYLE_INSTRUCTIONS['bw'];
  const fullCommonInstructions =
    commonInstructionsPart1 + colorInstruction + commonInstructionsPart2;
  return THEME_INSTRUCTIONS[selectedTheme] + fullCommonInstructions;
}


function getSelectedRatio(): string {
  return selectedRatio;
}

async function addSlide(text: string, image: HTMLImageElement) {
  const slide = document.createElement('div');
  slide.className = 'slide';
  slide.classList.add(`ratio-${getSelectedRatio()}`);
  const caption = document.createElement('div') as HTMLDivElement;
  caption.className = 'slide-caption';
  caption.innerHTML = await marked.parse(text);
  slide.append(image);
  slide.append(caption);
  slideshow.append(slide);

  const fadeInCaption = () => {
    caption.classList.add('fade-in');
  };

  if (image.complete) {
    requestAnimationFrame(fadeInCaption);
  } else {
    image.onload = fadeInCaption;
  }
}

function parseError(error: string) {
  const regex = /{"error":(.*)}/gm;
  const m = regex.exec(error);
  try {
    const e = m[1];
    const err = JSON.parse(e);
    return err.message;
  } catch (e) {
    return error;
  }
}

async function generate(message: string) {
  // Clear previous saved state from IndexedDB
  await clearDataFromDB(SLIDESHOW_KEY);

  userInput.disabled = true;
  generateBtn.disabled = true;

  modelOutput.innerHTML = '';
  slideshow.innerHTML = '';
  error.innerHTML = '';
  error.toggleAttribute('hidden', true);
  actionsContainer.toggleAttribute('hidden', true);

  try {
    const userTurn = document.createElement('div') as HTMLDivElement;
    userTurn.innerHTML = await marked.parse(message);
    userTurn.className = 'user-turn';
    modelOutput.append(userTurn);
    userInput.value = '';

    // Add the question as the first slide
    const questionSlide = document.createElement('div');
    questionSlide.className = 'slide question-slide';
    questionSlide.classList.add(`ratio-${getSelectedRatio()}`);
    const caption = document.createElement('div');
    caption.className = 'slide-caption';
    caption.innerHTML = `You asked:<br><strong>${message}</strong>`;
    questionSlide.append(caption);
    slideshow.append(questionSlide);
    slideshow.removeAttribute('hidden');
    requestAnimationFrame(() => caption.classList.add('fade-in'));

    const result = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash-image-preview',
      contents: {
        parts: [{text: message + getAdditionalInstructions()}],
      },
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    let text = '';
    let img = null;

    for await (const chunk of result) {
      for (const candidate of chunk.candidates) {
        for (const part of candidate.content.parts ?? []) {
          if (part.text) {
            text += part.text;
          } else {
            try {
              const data = part.inlineData;
              if (data) {
                img = document.createElement('img');
                img.src = `data:image/png;base64,` + data.data;
              } else {
                console.log('no data', chunk);
              }
            } catch (e) {
              console.log('no data', chunk);
            }
          }
          if (text && img) {
            await addSlide(text, img);
            text = '';
            img = null;
          }
        }
      }
    }
    if (img) {
      await addSlide(text, img);
      text = '';
    }
    if (slideshow.children.length > 1) {
      actionsContainer.removeAttribute('hidden');
      await saveSlideshowToStorage(message); // Save successful generation
    }
  } catch (e) {
    const msg = parseError(String(e));
    error.innerHTML = `Something went wrong: ${msg}`;
    error.removeAttribute('hidden');
  }
  userInput.disabled = false;
  generateBtn.disabled = false;
  userInput.focus();
}

/**
 * A helper function to wrap text on a canvas.
 * @param context The canvas rendering context.
 * @param text The text to wrap.
 * @param x The x coordinate of the text.
 * @param y The y coordinate of the text.
 * @param maxWidth The maximum width of a line.
 * @param lineHeight The height of a line.
 */
function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(' ');
  let line = '';
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = context.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      context.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  context.fillText(line, x, y);
}

/**
 * Generates a single tall image strip containing all slides for use in reels.
 * @returns A promise that resolves to a File object or null.
 */
async function generateReelStripFile(): Promise<File | null> {
  const allSlides = Array.from(
    slideshow.querySelectorAll('.slide'),
  ) as HTMLElement[];
  if (allSlides.length === 0) return null;

  const canvas = document.createElement('canvas');
  const frameWidth = 1080;
  const frameHeight = 1920;
  canvas.width = frameWidth;
  canvas.height = frameHeight * allSlides.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    await document.fonts.load('80px "Indie Flower"');
    await document.fonts.load('bold 90px "Indie Flower"');

    for (let i = 0; i < allSlides.length; i++) {
      const slide = allSlides[i];
      const yOffset = i * frameHeight;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, yOffset, frameWidth, frameHeight);
      ctx.fillStyle = '#495057';
      ctx.textAlign = 'center';

      if (slide.classList.contains('question-slide')) {
        const questionText = (
          (slide.querySelector('.slide-caption') as HTMLElement)?.innerText || ''
        )
          .replace('You asked:', '')
          .trim();
        ctx.font = '80px "Indie Flower"';
        ctx.fillText('You Asked:', frameWidth / 2, yOffset + 400);
        ctx.font = 'bold 90px "Indie Flower"';
        wrapText(
          ctx,
          questionText,
          frameWidth / 2,
          yOffset + 600,
          frameWidth - 150,
          110,
        );
      } else {
        const imgElement = slide.querySelector('img');
        const caption =
          slide.querySelector('.slide-caption')?.textContent?.trim() || '';
        if (imgElement) {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = imgElement.src;
          });
          const imgAspectRatio = image.width / image.height;
          const drawWidth = 980;
          const drawHeight = drawWidth / imgAspectRatio;
          const imgX = (frameWidth - drawWidth) / 2;
          const imgY = yOffset + (frameHeight - drawHeight) / 2 - 200;
          ctx.drawImage(image, imgX, imgY, drawWidth, drawHeight);

          ctx.font = '80px "Indie Flower"';
          const textY = imgY + drawHeight + 150;
          wrapText(ctx, caption, frameWidth / 2, textY, frameWidth - 100, 100);
        } else {
          ctx.font = '80px "Indie Flower"';
          wrapText(
            ctx,
            caption,
            frameWidth / 2,
            yOffset + frameHeight / 2,
            frameWidth - 100,
            100,
          );
        }
      }
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) return null;
    return new File([blob], 'reel-story.png', {type: 'image/png'});
  } catch (e) {
    console.error('Failed to generate reel strip file:', e);
    return null;
  }
}

/**
 * Creates a shareable image file from a single slide element.
 * @param slide The slide HTML element.
 * @param index The index of the slide.
 * @param ratio The desired aspect ratio ('1-1', '9-16', '16-9').
 * @returns A promise that resolves to a File object or null.
 */
async function generateSlideImageFile(
  slide: HTMLElement,
  index: number,
  ratio: string,
): Promise<File | null> {
  const canvas = document.createElement('canvas');
  let canvasWidth = 1080,
    canvasHeight = 1080;

  switch (ratio) {
    case '9-16':
      canvasWidth = 1080;
      canvasHeight = 1920;
      break;
    case '16-9':
      canvasWidth = 1920;
      canvasHeight = 1080;
      break;
  }

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  await document.fonts.load('60px "Indie Flower"');
  await document.fonts.load('bold 70px "Indie Flower"');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#495057';
  ctx.textAlign = 'center';

  if (slide.classList.contains('question-slide')) {
    const questionText = (
      (slide.querySelector('.slide-caption') as HTMLElement)?.innerText || ''
    )
      .replace('You asked:', '')
      .trim();
    ctx.font = '60px "Indie Flower"';
    ctx.fillText('You Asked:', canvasWidth / 2, canvasHeight * 0.3);
    ctx.font = 'bold 70px "Indie Flower"';
    wrapText(
      ctx,
      questionText,
      canvasWidth / 2,
      canvasHeight * 0.4,
      canvasWidth - 150,
      90,
    );
  } else {
    const imgElement = slide.querySelector('img');
    const caption =
      slide.querySelector('.slide-caption')?.textContent?.trim() || '';
    if (imgElement) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = imgElement.src;
      });

      const imgMaxHeight = canvasHeight * 0.8;
      const imgMaxWidth = canvasWidth * 0.9;
      const imgAspectRatio = image.width / image.height;
      let drawHeight = imgMaxHeight;
      let drawWidth = drawHeight * imgAspectRatio;

      if (drawWidth > imgMaxWidth) {
        drawWidth = imgMaxWidth;
        drawHeight = drawWidth / imgAspectRatio;
      }

      const imgX = (canvasWidth - drawWidth) / 2;
      const imgY = canvasHeight * 0.05;
      ctx.drawImage(image, imgX, imgY, drawWidth, drawHeight);
      ctx.font = '60px "Indie Flower"';
      const textY = imgY + drawHeight + 40;
      wrapText(ctx, caption, canvasWidth / 2, textY, canvasWidth - 100, 80);
    }
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) return null;
  return new File([blob], `slide-${index + 1}.png`, {type: 'image/png'});
}

async function shareSlideshow() {
  const originalText = shareBtn.textContent;
  shareBtn.textContent = 'PREPARING...';
  shareBtn.disabled = true;

  try {
    const slides = Array.from(
      document.querySelectorAll('#slideshow .slide'),
    ) as HTMLElement[];
    if (slides.length === 0) {
      alert('No slides to share.');
      return;
    }

    const selectedRatio = getSelectedRatio();
    const files = (
      await Promise.all(
        slides.map((slide, index) =>
          generateSlideImageFile(slide, index, selectedRatio),
        ),
      )
    ).filter((f) => f !== null) as File[];

    if (files.length === 0) {
      alert('Could not generate images for sharing.');
      return;
    }

    if (navigator.canShare && navigator.canShare({files})) {
      await navigator.share({
        files: files,
        title: 'My Explanation Slideshow',
        text: 'Check out this explanation I made!',
      });
    } else {
      alert('Sharing is not supported on your browser.');
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('Error sharing slideshow:', err);
      alert('Could not share the slideshow.');
    }
  } finally {
    shareBtn.textContent = originalText;
    shareBtn.disabled = false;
  }
}

async function downloadReelImages() {
  reelBtn.textContent = 'GENERATING...';
  reelBtn.disabled = true;

  try {
    const reelFile = await generateReelStripFile();
    if (reelFile) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(reelFile);
      link.download = `reel-story.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } else {
      alert('Sorry, there was an error creating the images for your Reel.');
    }
  } catch (e) {
    console.error('Failed to generate reel images:', e);
    alert('Sorry, there was an error creating the images for your Reel.');
  } finally {
    reelBtn.textContent = 'DOWNLOAD REEL';
    reelBtn.disabled = false;
  }
}

async function shareReelImages() {
  const originalText = reelShareBtn.textContent;
  reelShareBtn.textContent = 'PREPARING...';
  reelShareBtn.disabled = true;

  try {
    const slides = Array.from(
      document.querySelectorAll('#slideshow .slide'),
    ) as HTMLElement[];
    if (slides.length === 0) {
      alert('No slides to share for a reel.');
      return;
    }

    // Reels are always 9:16
    const files = (
      await Promise.all(
        slides.map((slide, index) =>
          generateSlideImageFile(slide, index, '9-16'),
        ),
      )
    ).filter((f) => f !== null) as File[];

    if (files.length === 0) {
      alert('Could not generate reel images for sharing.');
      return;
    }

    if (navigator.canShare && navigator.canShare({files})) {
      await navigator.share({
        files: files,
        title: 'My Explanation Reel',
        text: 'Check out this explanation I made!',
      });
    } else {
      alert('Sharing is not supported on your browser.');
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('Error sharing reel images:', err);
      alert('Could not share the reel images.');
    }
  } finally {
    reelShareBtn.textContent = originalText;
    reelShareBtn.disabled = false;
  }
}

/**
 * Saves the current slideshow content to IndexedDB.
 * @param question The original user question.
 */
async function saveSlideshowToStorage(question: string) {
  const slideElements = Array.from(
    document.querySelectorAll('#slideshow .slide'),
  );

  if (slideElements.length <= 1) return; // Don't save if only question slide exists

  try {
    const slides = await Promise.all(
      slideElements.map(async (slide) => {
        const isQuestion = slide.classList.contains('question-slide');
        const text = slide.querySelector('.slide-caption')?.innerHTML || '';
        const imageSrc = slide.querySelector('img')?.src || null;
        const imageBlob = imageSrc ? await dataUrlToBlob(imageSrc) : null;
        return {isQuestion, text, imageBlob};
      }),
    );

    const dataToSave: SavedSlideshow = {
      question,
      theme: selectedTheme,
      ratio: selectedRatio,
      colorStyle: selectedColorStyle,
      slides,
    };

    await saveDataToDB(SLIDESHOW_KEY, dataToSave);
  } catch (e) {
    console.error('Failed to save slideshow to IndexedDB:', e);
  }
}


/**
 * Helper to update the visual selection state of a menu list.
 * @param list The UL element.
 * @param value The data-value of the selected item.
 */
function updateMenuListSelection(list: HTMLUListElement, value: string) {
  const items = list.querySelectorAll('li');
  items.forEach(item => {
    const textNode = item.childNodes[0] as Text;
    const currentText = textNode.textContent || '';
    if (item.dataset.value === value) {
      item.classList.add('selected');
      textNode.textContent = currentText.replace(/\[\s{3}\]/, '[ * ]');
    } else {
      item.classList.remove('selected');
      textNode.textContent = currentText.replace(/\[ \* \]/, '[   ]');
    }
  });
}

/**
 * Sets the theme class on the main app container.
 * @param theme The theme name (e.g., 'cats', 'robots').
 */
function setAppTheme(theme: string) {
  appContainer.className = `app-container theme-${theme}`;
}

/**
 * Loads and restores a slideshow from IndexedDB if one exists.
 */
async function loadSlideshowFromStorage() {
  try {
    const savedData = await loadDataFromDB<SavedSlideshow>(SLIDESHOW_KEY);
    if (!savedData) {
      setAppTheme(selectedTheme); // Apply default theme if no saved data
      return;
    }

    const {question, theme, ratio, colorStyle, slides} = savedData;

    // Restore theme and ratio selection
    selectedTheme = theme;
    selectedRatio = ratio;
    selectedColorStyle = colorStyle || 'bw';
    setAppTheme(theme);
    updateMenuListSelection(themeSelector, theme);
    updateMenuListSelection(ratioSelector, ratio);
    updateMenuListSelection(colorSelector, selectedColorStyle);
    

    // Restore user prompt display
    const userTurn = document.createElement('div');
    userTurn.innerHTML = await marked.parse(question);
    userTurn.className = 'user-turn';
    modelOutput.append(userTurn);

    // Rebuild slideshow
    slideshow.innerHTML = '';
    const ratioToApply = ratio || '1-1';
    for (const slideData of slides) {
      const slide = document.createElement('div');
      slide.className = 'slide';
      slide.classList.add(`ratio-${ratioToApply}`);
      if (slideData.isQuestion) {
        slide.classList.add('question-slide');
      }

      const caption = document.createElement('div');
      caption.className = 'slide-caption';
      caption.innerHTML = slideData.text; // Use innerHTML as we saved it

      if (slideData.imageBlob) {
        const image = document.createElement('img');
        slide.append(image);
        slide.append(caption);
        slideshow.append(slide);

        const fadeInCaption = () => caption.classList.add('fade-in');

        image.onload = fadeInCaption;
        image.src = URL.createObjectURL(slideData.imageBlob);
        if (image.complete) {
          requestAnimationFrame(fadeInCaption);
        }
      } else {
        slide.append(caption);
        slideshow.append(slide);
        requestAnimationFrame(() => caption.classList.add('fade-in'));
      }
    }

    slideshow.removeAttribute('hidden');
    actionsContainer.removeAttribute('hidden');

  } catch (e) {
    console.error('Failed to load saved slideshow:', e);
    // Clear potentially corrupted data
    await clearDataFromDB(SLIDESHOW_KEY);
  }
}

/**
 * Copies all slide text to the clipboard.
 */
async function copyAllText() {
  const slideCaptions = Array.from(
    slideshow.querySelectorAll('.slide .slide-caption'),
  ) as HTMLElement[];

  if (slideCaptions.length === 0) return;

  const allText = slideCaptions
    .map((caption) => caption.innerText.trim())
    .join('\n\n');

  try {
    await navigator.clipboard.writeText(allText);
    const originalText = copyTextBtn.textContent;
    copyTextBtn.textContent = 'COPIED!';
    copyTextBtn.disabled = true;
    setTimeout(() => {
      copyTextBtn.textContent = originalText;
      copyTextBtn.disabled = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy text: ', err);
    alert('Could not copy text to clipboard.');
  }
}

// Hide share buttons if not supported
if (!navigator.share) {
  shareBtn.style.display = 'none';
  reelShareBtn.style.display = 'none';
}

async function handleGeneration() {
  const message = userInput.value.trim();
  if (message) {
    await generate(message);
  }
}

userInput.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.code === 'Enter') {
    e.preventDefault();
    await handleGeneration();
  }
});

generateBtn.addEventListener('click', handleGeneration);

const examples = document.querySelectorAll('#examples li');
examples.forEach((li) =>
  li.addEventListener('click', async (e) => {
    await generate(li.textContent!);
  }),
);

downloadBtn.addEventListener('click', () => {
  const images = slideshow.querySelectorAll('img');
  images.forEach((img, index) => {
    const link = document.createElement('a');
    link.href = img.src;
    link.download = `explanation-slide-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});


themeSelector.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'LI' && target.dataset.value) {
    selectedTheme = target.dataset.value;
    updateMenuListSelection(themeSelector, selectedTheme);
    setAppTheme(selectedTheme);
  }
});


ratioSelector.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'LI' && target.dataset.value) {
    selectedRatio = target.dataset.value;
    updateMenuListSelection(ratioSelector, selectedRatio);
  }
});

colorSelector.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'LI' && target.dataset.value) {
    selectedColorStyle = target.dataset.value;
    updateMenuListSelection(colorSelector, selectedColorStyle);
  }
});


copyTextBtn.addEventListener('click', copyAllText);
shareBtn.addEventListener('click', shareSlideshow);
reelBtn.addEventListener('click', downloadReelImages);
reelShareBtn.addEventListener('click', shareReelImages);

// Load any saved slideshow from a previous session on startup
loadSlideshowFromStorage();