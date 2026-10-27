# Using AccordionItem

An item is a heading that shows and hides a region of content. Put it in an [Accordion](#/components/Accordion) when there are several.

- Fill the `title` slot with the heading text, and the default slot with the content.
- It starts closed. Set `open` to start it open, or to change it from outside.
- The `expand` event says where it is going: `{ expanded, source }`.
- The heading is an `h3`. Use it where an `h3` fits the page outline.

```tess live
<template>
  <Accordion>
    <AccordionItem>
      <span slot="title">What is a contract?</span>
      A component's description of itself: variants, states, slots and events.
    </AccordionItem>
    <AccordionItem open>
      <span slot="title">Who checks it?</span>
      The compiler, on every build.
    </AccordionItem>
  </Accordion>
</template>
```
