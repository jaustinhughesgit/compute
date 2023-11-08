module.exports = (dynamodb) => {
    return {
        handlePost: (req, res) => {
            const path = req.params[0];
            const postData = req.body;
            const action = postData.api;
            switch(action) {
                case 'add':
                    // Your logic for "add" here
                    break;
                case 'remove':
                    // Your logic for "remove" here
                    break;
                default:
                    res.status(400).send('Invalid action');
            }


            res.json({ message: 'Success', data: postData });
        }
    };
};