const init = async () => {
    try {
        console.time('total-time');

        

    } catch (error) {
        console.error(error);
    } finally {
        console.timeEnd('total-time');
    }
};

init();