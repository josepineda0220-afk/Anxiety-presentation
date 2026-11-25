/**
 * The DOM side of typing in a text box: drawing its text in each size and colour, and
 * reading the text and caret back out as character offsets.
 */
import { charFormats, segmentsOf, type FormattedText } from './format'

export interface DomSelection {
  anchor: number
  focus: number
}

// Some insertions (a multi-line replacement, for one) wrap each new line in a block.
const isBlock = (node: Node) => node.nodeName === 'DIV' || node.nodeName === 'P'
const isElement = (node: Node, name: string) => node.nodeName === name
/** Whether a leaf stands for a line break rather than text. */
const isBreak = (node: Node) => node.nodeType !== Node.TEXT_NODE

/** The text nodes and line breaks under a node, in order. A block counts as the break before it. */
function leaves(root: Node, found: Node[] = []): Node[] {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE || isElement(node, 'BR')) {
      found.push(node)
      continue
    }
    if (isBlock(node) && (found.length > 0 || node.previousSibling)) found.push(node)
    const inside = found.length
    leaves(node, found)
    // A break element at the end of a block only holds its line open.
    if (isBlock(node) && found.length > inside && isElement(found[found.length - 1], 'BR')) found.pop()
  }
  return found
}

const textOf = (nodes: Node[]) => nodes.map((node) => (isBreak(node) ? '\n' : node.textContent)).join('')

/** The typed text. A line break element at the very end only holds the last line open. */
export function readText(element: HTMLElement): string {
  const nodes = leaves(element)
  if (nodes.length > 0 && isElement(nodes[nodes.length - 1], 'BR')) nodes.pop()
  return textOf(nodes)
}

const isMixed = (box: FormattedText) => box.sizes !== undefined || box.colors !== undefined

/** Whether the element already shows this text in these formats, so it can be left alone. */
export function showsBox(element: HTMLElement, box: FormattedText): boolean {
  if (readText(element) !== box.text) return false
  const stray = (node: Element) => !['SPAN', 'BR'].includes(node.nodeName) || node.hasAttribute('style')
  if (Array.from(element.querySelectorAll('*')).some(stray)) return false
  const chars = charFormats(box)
  const mixed = isMixed(box)
  let at = 0
  return leaves(element).every((node) => {
    if (isBreak(node)) {
      at++
      return true
    }
    const { size, color } = node.parentElement!.dataset
    const length = node.textContent!.length
    // In mixed text every character must carry its own format.
    const right = chars
      .slice(at, at + length)
      .every((format) =>
        mixed
          ? size === format.style && color === format.color
          : (!size || size === format.style) && (!color || color === format.color),
      )
    at += length
    return right
  })
}

export function drawBox(element: HTMLElement, box: FormattedText) {
  if (!isMixed(box)) element.textContent = box.text
  else {
    element.replaceChildren(
      ...segmentsOf(box.text, charFormats(box)).map(({ text, style, color }) => {
        const span = document.createElement('span')
        span.dataset.size = style
        span.dataset.color = color
        span.textContent = text
        return span
      }),
    )
  }
  // Without this the caret cannot be put on an empty last line.
  if (box.text.endsWith('\n')) element.append(document.createElement('br'))
}

/** The character offset of a position in the element. */
function offsetOf(element: HTMLElement, node: Node, offset: number): number {
  const before = document.createRange()
  before.setStart(element, 0)
  before.setEnd(node, offset)
  return Math.min(textOf(leaves(before.cloneContents())).length, readText(element).length)
}

/** The position in the element for a character offset. */
function pointAt(element: HTMLElement, offset: number): [Node, number] {
  let left = offset
  for (const node of leaves(element)) {
    if (isBreak(node)) {
      if (left === 0) return [node.parentNode!, Array.prototype.indexOf.call(node.parentNode!.childNodes, node)]
      left--
      continue
    }
    const text = node.textContent!
    // Between two stretches the caret stays with the earlier one, unless that one ends its line.
    if (left < text.length || (left === text.length && !text.endsWith('\n'))) return [node, left]
    left -= text.length
  }
  return [element, element.childNodes.length]
}

/** The selection as character offsets, if it is inside the element. */
export function readSelection(element: HTMLElement): DomSelection | null {
  const selection = window.getSelection()
  const { anchorNode, focusNode } = selection ?? {}
  if (!selection || !anchorNode || !focusNode || !element.contains(anchorNode) || !element.contains(focusNode)) return null
  return {
    anchor: offsetOf(element, anchorNode, selection.anchorOffset),
    focus: offsetOf(element, focusNode, selection.focusOffset),
  }
}

export function writeSelection(element: HTMLElement, { anchor, focus }: DomSelection) {
  window.getSelection()?.setBaseAndExtent(...pointAt(element, anchor), ...pointAt(element, focus))
}
