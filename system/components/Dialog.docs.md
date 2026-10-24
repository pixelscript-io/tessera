# Using Dialog

Use a dialog for something that **needs an answer before the person goes on**: confirming a deletion, a short form. For information that can wait, use the page.

- Fill the `title` slot (it is the dialog's name for assistive technology), the default slot with the content, and the `actions` slot with the buttons.
- It is closed until `open` is true. It takes focus, makes the page behind it inert, stops the page scrolling, keeps Tab inside, and gives focus back to what opened it when it closes.
- Escape and a click outside the panel fire `dismiss` with a `reason`. The dialog closes itself; listen for `dismiss` and set `open` to false to keep your state in step. Set `persistent` to keep it open until you set `open`, for example to confirm before closing.
- Always give a visible way to close it in `actions`: Escape and the backdrop are shortcuts.

```tess live
<script>
const open = state(false)
</script>

<template>
  <div>
    <Button @press="open.value = true">Delete project</Button>
    <Dialog :open="open" @dismiss="open.value = false">
      <span slot="title">Delete this project?</span>
      This removes its files and cannot be undone.
      <div slot="actions">
        <Button tone="neutral" emphasis="outline" @press="open.value = false">Cancel</Button>
        <Button tone="danger" @press="open.value = false">Delete</Button>
      </div>
    </Dialog>
  </div>
</template>
```
