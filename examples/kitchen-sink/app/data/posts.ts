export interface Post {
  slug: string
  title: string
  body: string
}

export const posts: Post[] = [
  { slug: 'hello-world', title: 'Hello, world', body: 'The first post.' },
  { slug: 'signals', title: 'Why signals', body: 'Fine-grained updates, no virtual DOM.' },
  {
    slug: 'contracts',
    title: 'Contracts first',
    body: 'Every component declares what it promises.',
  },
]
