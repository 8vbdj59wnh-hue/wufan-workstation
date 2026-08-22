const thumbnailPreviewSelector = [
  ".content-thumb",
  ".task-cover-thumb",
  ".schedule-board-thumb",
  ".template-material-thumb img",
  ".content-template-thumb img",
  ".content-template-option-thumb img",
  ".image-preview-box img",
  ".attachment-preview-card.is-image img",
  ".submit-file-preview img",
  ".work-form-image",
  ".form-renderer-image-preview",
  ".method-media",
  "[data-link-image-preview]",
].join(",");

const previewGap = 12;
const previewMaxWidth = 800;
let previewElement = null;
let previewImage = null;
let activeThumbnail = null;

function getThumbnailImage(target) {
  if (!(target instanceof Element)) return null;
  const image = target instanceof HTMLImageElement ? target : target.closest("img");
  if (!(image instanceof HTMLImageElement)) return null;
  if (image.closest("[data-task-card]") !== null) return null;
  return image.matches(thumbnailPreviewSelector) ? image : null;
}

function getPreviewElement() {
  if (previewElement !== null && previewImage !== null) return previewElement;

  previewElement = document.createElement("div");
  previewElement.className = "thumbnail-hover-preview is-hidden";
  previewElement.setAttribute("aria-hidden", "true");

  previewImage = document.createElement("img");
  previewImage.alt = "";
  previewElement.appendChild(previewImage);
  document.body.appendChild(previewElement);

  return previewElement;
}

function hideThumbnailPreview() {
  activeThumbnail = null;
  previewElement?.classList.add("is-hidden");
  if (previewImage !== null) previewImage.removeAttribute("src");
}

function getImageDisplaySize(image, viewportWidth, viewportHeight, maximumWidth = previewMaxWidth) {
  const naturalWidth = image.naturalWidth || image.width || previewMaxWidth;
  const naturalHeight = image.naturalHeight || image.height || naturalWidth;
  const maxAvailableWidth = Math.max(120, viewportWidth - previewGap * 2);
  const maxAvailableHeight = Math.max(120, viewportHeight - previewGap * 2);
  const targetWidth = Math.min(naturalWidth, maximumWidth, maxAvailableWidth);
  const widthScale = targetWidth / naturalWidth;
  const heightAtWidth = naturalHeight * widthScale;

  if (heightAtWidth <= maxAvailableHeight) {
    return {
      width: targetWidth,
      height: heightAtWidth,
    };
  }

  const heightScale = maxAvailableHeight / naturalHeight;
  return {
    width: naturalWidth * heightScale,
    height: maxAvailableHeight,
  };
}

function positionThumbnailPreview(anchor) {
  if (previewElement === null || previewImage === null) return;
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const configuredWidth = Number(anchor.dataset.previewMaxWidth || 0);
  const { width, height } = getImageDisplaySize(previewImage, viewportWidth, viewportHeight,
    configuredWidth > 0 ? configuredWidth : previewMaxWidth);

  previewElement.style.width = `${Math.round(width)}px`;
  previewImage.style.width = `${Math.round(width)}px`;
  previewImage.style.height = `${Math.round(height)}px`;

  let left;
  let top;
  if (anchor.matches("[data-link-image-preview]")) {
    left = Math.min(Math.max(rect.left, previewGap), viewportWidth - width - previewGap);
    top = rect.bottom + previewGap;
    if (top + height > viewportHeight - previewGap) top = rect.top - height - previewGap;
  } else {
    left = rect.right + previewGap;
    if (left + width > viewportWidth - previewGap) left = rect.left - width - previewGap;
    top = rect.top;
  }
  if (left < previewGap) left = previewGap;
  if (top + height > viewportHeight - previewGap) top = viewportHeight - height - previewGap;
  if (top < previewGap) top = previewGap;

  previewElement.style.left = `${Math.round(left)}px`;
  previewElement.style.top = `${Math.round(top)}px`;
}

function showThumbnailPreview(image) {
  const src = image.currentSrc || image.src;
  if (src === "") return;

  activeThumbnail = image;
  const preview = getPreviewElement();
  preview.classList.add("is-loading");
  preview.classList.remove("is-hidden");

  if (previewImage === null) return;
  previewImage.onload = () => {
    if (activeThumbnail !== image) return;
    preview.classList.remove("is-loading");
    positionThumbnailPreview(image);
  };
  previewImage.onerror = hideThumbnailPreview;
  previewImage.src = src;

  if (previewImage.complete && previewImage.naturalWidth > 0) {
    previewImage.onload?.(new Event("load"));
  } else {
    positionThumbnailPreview(image);
  }
}

export function attachThumbnailHoverPreview() {
  if (document.body.dataset.thumbnailHoverPreviewBound === "true") return;
  document.body.dataset.thumbnailHoverPreviewBound = "true";

  document.addEventListener("mouseover", (event) => {
    const image = getThumbnailImage(event.target);
    if (image === null || image === activeThumbnail) return;
    showThumbnailPreview(image);
  });

  document.addEventListener("mouseout", (event) => {
    const image = getThumbnailImage(event.target);
    if (image === null || image !== activeThumbnail) return;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && image.contains(relatedTarget)) return;
    hideThumbnailPreview();
  });

  document.addEventListener("scroll", hideThumbnailPreview, true);
  window.addEventListener("resize", hideThumbnailPreview);
}
