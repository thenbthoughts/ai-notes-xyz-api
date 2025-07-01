import { NodeHtmlMarkdown } from 'node-html-markdown';

const init = async () => {
    const processedValue = `
        <p>Hello</p>
        <p>World</p>
        <img src="https://www.examole.com/images/example.png" />
    `

    const markdownContent = NodeHtmlMarkdown.translate(processedValue);

    console.log(markdownContent);

}

init();

// npx ts-node -r dotenv/config ./srcTest/test-lib/test-lib-2.ts