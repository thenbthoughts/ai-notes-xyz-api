import htmlToMarkdown from '@wcj/html-to-markdown';

const init = async () => {

    const processedValue = `
        <p>Hello</p>
        <p>World</p>
        <img src="https://www.examole.com/images/example.png" />
    `

    const markdownContent = await htmlToMarkdown({
        html: processedValue,
    });

    console.log(markdownContent);
}

init();

// npx ts-node -r dotenv/config ./srcTest/test-lib/test-lib.ts