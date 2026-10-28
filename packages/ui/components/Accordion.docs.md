# Using Accordion

An accordion groups [AccordionItem](#/components/AccordionItem)s so they share a border and spacing. Each item opens and closes on its own: an accordion does not close the others when one opens.

```tess live
<template>
  <Accordion>
    <AccordionItem>
      <span slot="title">Is it accessible?</span>
      Yes. Each heading is a button that says whether its region is open.
    </AccordionItem>
    <AccordionItem>
      <span slot="title">Can I change it?</span>
      It is a copy in your project, so yes.
    </AccordionItem>
  </Accordion>
</template>
```
