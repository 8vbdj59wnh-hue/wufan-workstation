import { resolveAssetUrl, uploadImageFile } from "./appState.js?v=20260705-state-singleton1";
import { getActionImageUrls } from "./data/taskUtils.js?v=20260705-state-singleton1";

const productImageFieldKeys = new Set(["coverImageUrl", "productImage", "productImages"]);
const maxProductImages = 9;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isValidUrl(value) {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidImagePath(value) {
  return value.startsWith("/uploads/images/") || isValidUrl(value);
}

function getEditorImageUrls(field) {
  return Array.from(field.querySelectorAll('input[name="custom__productImages"]'))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function renderEditorImageItems(imageUrls) {
  if (imageUrls.length === 0) return `<span class="product-image-editor-empty">暂无图片</span>`;
  return imageUrls
    .map(
      (url, index) => `
        <span class="product-image-editor-item">
          <img src="${escapeHtml(resolveAssetUrl(url))}" alt="产品图片${index + 1}" onerror="this.replaceWith('图片无法预览')" />
          <button type="button" class="icon-button product-image-remove" data-action="remove-product-image" data-image-index="${index}" aria-label="移除第${index + 1}张产品图片">×</button>
        </span>
      `,
    )
    .join("");
}

function updateProductImageEditor(field, imageUrls) {
  const normalizedUrls = [...new Set(imageUrls.filter(Boolean))].slice(0, maxProductImages);
  field.querySelectorAll('[data-product-image-hidden]').forEach((input) => input.remove());
  const uploadInput = field.querySelector("[data-image-upload-key]");
  normalizedUrls.forEach((url) => {
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = "custom__productImages";
    hidden.value = url;
    hidden.dataset.productImageHidden = "";
    field.insertBefore(hidden, uploadInput);
  });
  const legacyInput = field.querySelector("[data-product-image-legacy]");
  if (legacyInput !== null) legacyInput.value = normalizedUrls[0] ?? "";
  const preview = field.querySelector("[data-product-image-preview]");
  if (preview !== null) preview.innerHTML = renderEditorImageItems(normalizedUrls);
}

export function isProductImageField(field) {
  return field?.type === "image" && productImageFieldKeys.has(field.key);
}

export function renderProductImageEditor(field, customFields = {}) {
  const imageUrls = getActionImageUrls({ customFields });
  return `
    <div class="image-url-field product-image-field">
      <span>${escapeHtml(field.label)}</span>
      ${imageUrls.map((url) => `<input type="hidden" name="custom__productImages" value="${escapeHtml(url)}" data-product-image-hidden />`).join("")}
      <input type="hidden" name="custom__${escapeHtml(field.key)}" value="${escapeHtml(imageUrls[0] ?? "")}" data-product-image-legacy />
      <input
        name="upload__${escapeHtml(field.key)}"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        data-image-upload-key="${escapeHtml(field.key)}"
        data-product-images-upload
      />
      <span class="form-note">最多上传9张1:1产品图，支持 JPG、PNG、WebP，单张不超过 5MB。</span>
      <span class="product-image-editor-grid" data-product-image-preview>
        ${renderEditorImageItems(imageUrls)}
      </span>
    </div>
  `;
}

export function collectProductImageField(formData, result, field) {
  const imageUrls = [...new Set(formData.getAll("custom__productImages").map((item) => item.toString()).filter(Boolean))]
    .slice(0, maxProductImages);
  result.productImages = imageUrls;
  result[field.key] = imageUrls[0] ?? "";
  return result;
}

export function validateProductImages(customFields = {}) {
  const imageUrls = Array.isArray(customFields.productImages) ? customFields.productImages : [];
  if (imageUrls.length > maxProductImages) return "产品图片最多上传9张。";
  if (imageUrls.some((url) => !isValidImagePath(String(url ?? "").trim()))) return "产品图片必须是上传后的图片路径。";
  return "";
}

export async function handleProductImagesUpload(input) {
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return [];
  const field = input.closest(".product-image-field");
  if (field === null) return [];
  const existingUrls = getEditorImageUrls(field);
  if (existingUrls.length + files.length > maxProductImages) {
    throw new Error(`产品图片最多上传${maxProductImages}张。`);
  }
  const preview = field.querySelector("[data-product-image-preview]");
  if (preview !== null) preview.textContent = "上传中...";

  const uploadedUrls = [];
  try {
    for (const file of files) {
      const result = await uploadImageFile(file);
      uploadedUrls.push(result.url);
    }
    updateProductImageEditor(field, [...existingUrls, ...uploadedUrls]);
    input.value = "";
    return uploadedUrls;
  } catch (error) {
    updateProductImageEditor(field, existingUrls);
    throw error;
  }
}

export function removeProductImage(button) {
  const field = button.closest(".product-image-field");
  if (field === null) return;
  const removeIndex = Number(button.dataset.imageIndex);
  updateProductImageEditor(
    field,
    getEditorImageUrls(field).filter((_url, index) => index !== removeIndex),
  );
}

export function renderActionImageGrid(
  images,
  { className = "", alt = "产品图片", placeholder = "无图", preserveEmptySlots = false } = {},
) {
  const sourceImages = Array.isArray(images) ? images : [];
  const imageUrls = preserveEmptySlots
    ? sourceImages.map((url) => String(url ?? "").trim()).slice(0, maxProductImages)
    : [...new Set(sourceImages.filter(Boolean))].slice(0, maxProductImages);
  if (imageUrls.length === 0) {
    return `<div class="action-image-grid action-image-grid-empty ${escapeHtml(className)}">${escapeHtml(placeholder)}</div>`;
  }
  const layoutClass = imageUrls.length === 1 ? "is-single" : imageUrls.length <= 4 ? "is-four" : "is-nine";
  return `
    <div class="action-image-grid ${layoutClass} ${escapeHtml(className)}" data-image-count="${imageUrls.length}">
      ${imageUrls
        .map(
          (url, index) => `
            ${
              url === ""
                ? `<span class="action-image-grid-broken">无图</span>`
                : `<img
                    src="${escapeHtml(resolveAssetUrl(url))}"
                    alt="${escapeHtml(alt)}${imageUrls.length === 1 ? "" : `${index + 1}`}"
                    onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'action-image-grid-broken', textContent: '无图' }))"
                  />`
            }
          `,
        )
        .join("")}
    </div>
  `;
}
